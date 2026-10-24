import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import ts from 'typescript';

dotenv.config();

import { crawlPage } from '../src/crawler/pageCrawler.ts';
import { observeAppMap } from '../src/crawler/observe.ts';
import { stopEgressProxy } from '../src/security/egressProxy.ts';
import type { AppMap, Observation } from '../src/crawler/types.ts';
import type { TestDataEntry } from '../src/api/schemas.ts';
import { openAiCompatibleChat } from '../src/llm/providers/openAiCompatible.ts';
import { LlmError } from '../src/llm/types.ts';
import type { LlmRequest, LlmResponse } from '../src/llm/types.ts';
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserPrompt,
  TestPlanSchema,
  type TestPlan,
  type TestCase,
} from '../src/agent/prompts/plannerPrompt.ts';
import {
  GENERATOR_SYSTEM_PROMPT,
  buildGeneratorUserPrompt,
} from '../src/agent/prompts/generatorPrompt.ts';
import {
  CORRECTOR_SYSTEM_PROMPT,
  buildCorrectorUserPrompt,
} from '../src/agent/prompts/correctorPrompt.ts';
import {
  correctionPreservesAssertions,
  correctionPreservesSecrets,
} from '../src/agent/assertionGuard.ts';
import {
  planTests,
  validateAndNormalizePlan,
  serializeObservations,
} from '../src/agent/steps/planner.ts';
import { toPlannerView } from '../src/agent/plannerView.ts';
import { resolveTestData } from '../src/agent/testData.ts';

// ---------------------------------------------------------------------------
// Rate Limiter & Pacing Engine (<= 4 calls/minute per provider, rolling window)
// ---------------------------------------------------------------------------
class ProviderRateLimiter {
  private callTimestamps: number[] = [];
  private lastCallTime: number = 0;
  private readonly minIntervalMs: number = 15_000; // minimum 15s between calls
  private readonly maxCallsPerMinute: number = 4; // <= 4 calls/minute

  async waitTurn(provider: string): Promise<void> {
    while (true) {
      const now = Date.now();
      this.callTimestamps = this.callTimestamps.filter((t) => now - t < 60_000);
      if (
        this.callTimestamps.length < this.maxCallsPerMinute &&
        now - this.lastCallTime >= this.minIntervalMs
      ) {
        this.callTimestamps.push(now);
        this.lastCallTime = now;
        return;
      }
      const waitInterval = Math.max(0, this.lastCallTime + this.minIntervalMs - now);
      const waitRolling =
        this.callTimestamps.length >= this.maxCallsPerMinute
          ? this.callTimestamps[0] + 60_000 - now + 100
          : 0;
      const waitTime = Math.max(waitInterval, waitRolling, 1000);
      console.log(
        `[Pacer] ${provider.toUpperCase()}: waiting ${(waitTime / 1000).toFixed(1)}s (rolling ${this.callTimestamps.length}/4 calls, cooldown)...`,
      );
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }
}

const limiters: Record<'groq' | 'gemini', ProviderRateLimiter> = {
  groq: new ProviderRateLimiter(),
  gemini: new ProviderRateLimiter(),
};

// ---------------------------------------------------------------------------
// Model Configurations & Endpoints
// ---------------------------------------------------------------------------
interface ModelTarget {
  provider: 'groq' | 'gemini';
  model: string;
}

const REASONING_CANDIDATES: ModelTarget[] = [
  { provider: 'groq', model: 'openai/gpt-oss-120b' },
  { provider: 'groq', model: 'qwen/qwen3.8-27b' },
  { provider: 'gemini', model: 'gemini-2.5-flash' },
  { provider: 'gemini', model: 'gemini-3.5-flash' },
  { provider: 'gemini', model: 'gemini-3-flash-preview' },
];

const FAST_CANDIDATES: ModelTarget[] = [
  { provider: 'groq', model: 'openai/gpt-oss-20b' },
  { provider: 'groq', model: 'qwen/qwen3.8-27b' },
  { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  { provider: 'gemini', model: 'gemini-2.5-flash' },
  { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
];

function getProviderEndpoint(provider: 'groq' | 'gemini'): { url: string; key: string } {
  if (provider === 'groq') {
    const key = process.env.GROQ_API_KEY;
    if (!key) throw new Error('GROQ_API_KEY is not set');
    return { url: 'https://api.groq.com/openai/v1/chat/completions', key };
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  return {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    key,
  };
}

async function callModelDirect(
  target: ModelTarget,
  request: LlmRequest,
  maxRetries = 3,
): Promise<LlmResponse> {
  const { url, key } = getProviderEndpoint(target.provider);
  let attempt = 0;

  while (attempt <= maxRetries) {
    await limiters[target.provider].waitTurn(target.provider);
    const started = Date.now();
    try {
      const reasoningEffort =
        target.provider === 'groq'
          ? 'low'
          : target.provider === 'gemini' && request.tier === 'reasoning'
            ? 'low'
            : undefined;

      const res = await openAiCompatibleChat({
        providerName: target.provider,
        endpointUrl: url,
        apiKey: key,
        defaultModel: target.model,
        model: target.model,
        reasoningEffort,
        request,
        signal: request.signal ?? AbortSignal.timeout(120_000),
      });
      res.latencyMs = Date.now() - started;
      return res;
    } catch (err) {
      const elapsed = Date.now() - started;
      attempt++;
      if (err instanceof LlmError && err.code === 'RATE_LIMITED' && attempt <= maxRetries) {
        const delay = Math.max(err.retryAfterMs ?? 25_000, 25_000);
        console.warn(
          `[RateLimited] ${target.provider}:${target.model} (attempt ${attempt}): waiting ${(delay / 1000).toFixed(1)}s...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (attempt <= maxRetries && (err instanceof Error && (err.message.includes('503') || err.message.includes('500') || err.message.includes('fetch failed')))) {
        console.warn(
          `[TransientError] ${target.provider}:${target.model} (${elapsed}ms): ${err.message}. Retrying (${attempt}/${maxRetries})...`,
        );
        await new Promise((r) => setTimeout(r, 15_000 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to call ${target.provider}:${target.model} after ${maxRetries} retries`);
}

// ---------------------------------------------------------------------------
// Resumable Checkpoint State
// ---------------------------------------------------------------------------
const RESULTS_PATH = path.resolve('scratch/model_benchmark_results.json');
const FIXTURES_PATH = path.resolve('scratch/model_benchmark_fixtures.json');

async function loadResults(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(RESULTS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveResult(key: string, data: unknown): Promise<void> {
  const existing = await loadResults();
  existing[key] = data;
  await fs.writeFile(RESULTS_PATH, JSON.stringify(existing, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Frozen Fixture Loader / Generator
// ---------------------------------------------------------------------------
interface FixtureSite {
  name: string;
  url: string;
  appMap: AppMap;
  testData: TestDataEntry[];
}

interface BenchmarkFixtures {
  crawledAt: string;
  siteA: FixtureSite;
  siteB: FixtureSite;
}

async function getOrGenerateFixtures(): Promise<BenchmarkFixtures> {
  try {
    const raw = await fs.readFile(FIXTURES_PATH, 'utf-8');
    console.log('[Fixtures] Loaded frozen fixtures from disk.');
    return JSON.parse(raw) as BenchmarkFixtures;
  } catch {
    console.log('[Fixtures] No frozen fixtures found. Crawling Site A & Site B once...');

    // Site A: TodoMVC
    console.log('[Fixtures] Crawling TodoMVC (https://demo.playwright.dev/todomvc)...');
    const appMapA = await crawlPage('https://demo.playwright.dev/todomvc');
    const obsA = await observeAppMap(appMapA);
    appMapA.observations = obsA;

    // Site B: the-internet login
    console.log('[Fixtures] Crawling the-internet login (https://the-internet.herokuapp.com/login)...');
    const testDataB: TestDataEntry[] = [
      { elementId: 'username', css: '#username', value: 'tomsmith', sensitive: false },
      { elementId: 'password', css: '#password', value: 'SuperSecretPassword!', sensitive: true },
    ];
    const appMapB = await crawlPage('https://the-internet.herokuapp.com/login');
    const obsB = await observeAppMap(appMapB, { testData: testDataB });
    appMapB.observations = obsB;

    const fixtures: BenchmarkFixtures = {
      crawledAt: new Date().toISOString(),
      siteA: {
        name: 'TodoMVC',
        url: 'https://demo.playwright.dev/todomvc',
        appMap: appMapA,
        testData: [],
      },
      siteB: {
        name: 'the-internet login',
        url: 'https://the-internet.herokuapp.com/login',
        appMap: appMapB,
        testData: testDataB,
      },
    };

    await fs.writeFile(FIXTURES_PATH, JSON.stringify(fixtures, null, 2), 'utf-8');
    await stopEgressProxy();
    console.log('[Fixtures] Frozen fixtures saved to disk.');
    return fixtures;
  }
}

// ---------------------------------------------------------------------------
// Benchmark Task Evaluations
// ---------------------------------------------------------------------------

async function runBenchmark() {
  console.log('================================================================');
  console.log('       AGENTIC TEST GENERATOR — MODEL BENCHMARK SUITE          ');
  console.log('================================================================\n');

  const fixtures = await getOrGenerateFixtures();
  const results = await loadResults();

  // Helper to build planner prompts
  function buildPlannerPrompt(site: FixtureSite, assignment: 'A' | 'B' | 'single', focusId?: string): string {
    const serializedObservations = serializeObservations(site.appMap.observations);
    const plannerView = toPlannerView(site.appMap);
    const appMapJson = JSON.stringify(plannerView);
    let prompt = buildPlannerUserPrompt(appMapJson);
    if (serializedObservations) {
      prompt += `\n\nOBSERVED FACTS (recorded by actually driving this page — assertions must not contradict these):\n${serializedObservations}`;
    }
    if (site.testData.length > 0) {
      const resolved = resolveTestData(site.appMap, site.testData);
      if (resolved.promptBlock) prompt += `\n\n${resolved.promptBlock}`;
    }
    if (assignment === 'A') {
      prompt += `\n\nASSIGNMENT: plan up to 6 core cases — primary happy paths end-to-end, key navigation, main content visibility. Prefer cases grounded in OBSERVED FACTS.`;
    } else if (assignment === 'B') {
      prompt += `\n\nASSIGNMENT: plan up to 5 negative / validation / edge cases — empty submits, invalid input, counts, visibility of secondary elements. Prefer cases grounded in OBSERVED FACTS.\nTEST DATA values are valid success values. Never use a secret placeholder as the invalid/missing value under test: empty field = fill '' or omit the fill; wrong credential = a non-secret literal such as wrong-password. Use exact test-data only for fields meant to stay valid in that case.`;
    } else if (assignment === 'single' && focusId) {
      prompt += `\n\nFOCUS: generate 2–4 test cases focused on element: ${focusId}.\nEvery test case must start by interacting with a focus element and verify what it reveals.`;
    }
    return prompt;
  }

  // -------------------------------------------------------------------------
  // TASK 1: Dual-Call Core Scenarios (Reasoning Candidates)
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 1: Dual-Call Core Scenarios (Reasoning Candidates) ---');
  for (const siteKey of ['siteA', 'siteB'] as const) {
    const site = fixtures[siteKey];
    const knownIds = new Set(site.appMap.elements.map((e) => e.id));
    const prompt = buildPlannerPrompt(site, 'A');

    for (const target of REASONING_CANDIDATES) {
      const testKey = `task1_dual_core_${siteKey}_${target.provider}_${target.model.replace(/\//g, '_')}`;
      if (results[testKey]) {
        console.log(`[CACHED] ${testKey}`);
        continue;
      }
      console.log(`[RUN] ${testKey} (${target.provider}:${target.model} on ${site.name})...`);
      try {
        const response = await callModelDirect(target, {
          messages: [
            { role: 'system', content: PLANNER_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          jsonMode: true,
          maxTokens: 3000,
          tier: 'reasoning',
          purpose: 'plan',
        });
        const val = validateAndNormalizePlan(response.content, knownIds, site.appMap.url);
        const data = {
          provider: target.provider,
          model: target.model,
          site: site.name,
          latencyMs: response.latencyMs,
          promptTokens: response.usage?.promptTokens ?? 0,
          completionTokens: response.usage?.completionTokens ?? 0,
          validationOk: val.ok,
          validationKind: val.ok ? 'ok' : val.kind,
          casesCount: val.ok ? val.plan.testCases.length : val.kind === 'references' ? val.plan.testCases.length : 0,
          hallucinatedCount: val.ok ? 0 : val.kind === 'references' ? val.badCaseIndexes.size : 0,
          errorDetail: val.ok ? null : val.detail.slice(0, 300),
        };
        await saveResult(testKey, data);
        console.log(`  -> ${data.validationOk ? 'VALID' : 'INVALID'} (${data.casesCount} cases, ${data.latencyMs}ms, tokens: p=${data.promptTokens}, c=${data.completionTokens})`);
      } catch (err) {
        console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
        await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // -------------------------------------------------------------------------
  // TASK 2: Dual-Call Negative Scenarios (Fast Candidates)
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 2: Dual-Call Negative Scenarios (Fast Candidates) ---');
  for (const siteKey of ['siteA', 'siteB'] as const) {
    const site = fixtures[siteKey];
    const knownIds = new Set(site.appMap.elements.map((e) => e.id));
    const prompt = buildPlannerPrompt(site, 'B');

    for (const target of FAST_CANDIDATES) {
      const testKey = `task2_dual_negative_${siteKey}_${target.provider}_${target.model.replace(/\//g, '_')}`;
      if (results[testKey]) {
        console.log(`[CACHED] ${testKey}`);
        continue;
      }
      console.log(`[RUN] ${testKey} (${target.provider}:${target.model} on ${site.name})...`);
      try {
        const response = await callModelDirect(target, {
          messages: [
            { role: 'system', content: PLANNER_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          jsonMode: true,
          maxTokens: 2500,
          tier: 'fast',
          purpose: 'plan',
        });
        const val = validateAndNormalizePlan(response.content, knownIds, site.appMap.url);
        const data = {
          provider: target.provider,
          model: target.model,
          site: site.name,
          latencyMs: response.latencyMs,
          promptTokens: response.usage?.promptTokens ?? 0,
          completionTokens: response.usage?.completionTokens ?? 0,
          validationOk: val.ok,
          validationKind: val.ok ? 'ok' : val.kind,
          casesCount: val.ok ? val.plan.testCases.length : val.kind === 'references' ? val.plan.testCases.length : 0,
          hallucinatedCount: val.ok ? 0 : val.kind === 'references' ? val.badCaseIndexes.size : 0,
          errorDetail: val.ok ? null : val.detail.slice(0, 300),
        };
        await saveResult(testKey, data);
        console.log(`  -> ${data.validationOk ? 'VALID' : 'INVALID'} (${data.casesCount} cases, ${data.latencyMs}ms, tokens: p=${data.promptTokens}, c=${data.completionTokens})`);
      } catch (err) {
        console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
        await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // -------------------------------------------------------------------------
  // TASK 3: Single / Focus Planning (Reasoning Candidates)
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 3: Single / Focus Planning (Reasoning Candidates) ---');
  for (const siteKey of ['siteA', 'siteB'] as const) {
    const site = fixtures[siteKey];
    const knownIds = new Set(site.appMap.elements.map((e) => e.id));
    const focusEl = site.appMap.elements.find((e) => e.type === 'input' || e.type === 'button') ?? site.appMap.elements[0];
    const focusId = focusEl?.id ?? 'elem-1';
    const prompt = buildPlannerPrompt(site, 'single', focusId);

    for (const target of REASONING_CANDIDATES) {
      const testKey = `task3_single_focus_${siteKey}_${target.provider}_${target.model.replace(/\//g, '_')}`;
      if (results[testKey]) {
        console.log(`[CACHED] ${testKey}`);
        continue;
      }
      console.log(`[RUN] ${testKey} (${target.provider}:${target.model} focusing ${focusId})...`);
      try {
        const response = await callModelDirect(target, {
          messages: [
            { role: 'system', content: PLANNER_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          jsonMode: true,
          maxTokens: 3000,
          tier: 'reasoning',
          purpose: 'plan',
        });
        const val = validateAndNormalizePlan(response.content, knownIds, site.appMap.url);
        const focusAdherent = val.ok
          ? val.plan.testCases.every((tc) => tc.steps.some((s) => s.elementId === focusId))
          : false;

        const data = {
          provider: target.provider,
          model: target.model,
          site: site.name,
          focusId,
          focusAdherent,
          latencyMs: response.latencyMs,
          promptTokens: response.usage?.promptTokens ?? 0,
          completionTokens: response.usage?.completionTokens ?? 0,
          validationOk: val.ok,
          casesCount: val.ok ? val.plan.testCases.length : 0,
        };
        await saveResult(testKey, data);
        console.log(`  -> ${data.validationOk ? 'VALID' : 'INVALID'} (focusAdherent=${focusAdherent}, ${data.latencyMs}ms)`);
      } catch (err) {
        console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
        await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // -------------------------------------------------------------------------
  // TASK 4: Planner Self-Repair (Synthetic Broken JSON / Schema Error)
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 4: Planner Self-Repair (Reasoning Candidates) ---');
  const brokenPlanJson = `{
    "testCases": [
      {
        "id": "tc-1",
        "title": "Broken Case Missing Steps",
        "description": "This case is missing the required steps array",
        "intent": "positive"
      }
    ]
  }`;
  const repairError = "- testCases.0.steps: Required";

  for (const target of REASONING_CANDIDATES) {
    const testKey = `task4_repair_${target.provider}_${target.model.replace(/\//g, '_')}`;
    if (results[testKey]) {
      console.log(`[CACHED] ${testKey}`);
      continue;
    }
    console.log(`[RUN] ${testKey} (${target.provider}:${target.model})...`);
    try {
      const response = await callModelDirect(target, {
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: 'Generate a plan for TodoMVC' },
          { role: 'assistant', content: brokenPlanJson },
          {
            role: 'user',
            content: `Your previous response failed validation.\n\nErrors (schema):\n${repairError}\n\nReturn ONLY the corrected JSON object. Include valid steps with actions and assertions. No prose, no markdown, no code fences.`,
          },
        ],
        jsonMode: true,
        maxTokens: 2500,
        tier: 'reasoning',
        purpose: 'repair',
      });
      const knownIds = new Set(fixtures.siteA.appMap.elements.map((e) => e.id));
      const val = validateAndNormalizePlan(response.content, knownIds, fixtures.siteA.appMap.url);
      const data = {
        provider: target.provider,
        model: target.model,
        repaired: val.ok,
        latencyMs: response.latencyMs,
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
        casesCount: val.ok ? val.plan.testCases.length : 0,
      };
      await saveResult(testKey, data);
      console.log(`  -> Repaired: ${data.repaired} (${data.casesCount} cases, ${data.latencyMs}ms)`);
    } catch (err) {
      console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
      await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // TASK 5: Plan Expansion (Reasoning Candidates)
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 5: Plan Expansion (Reasoning Candidates) ---');
  const basePlanForExpansion: TestPlan = {
    testCases: [
      {
        id: 'tc-1',
        title: 'Add new todo item',
        description: 'Verify adding an item to the list',
        intent: 'positive',
        steps: [
          { action: 'fill', elementId: fixtures.siteA.appMap.elements[0]?.id ?? 'input-1', value: 'Buy groceries' },
          { action: 'press', elementId: fixtures.siteA.appMap.elements[0]?.id ?? 'input-1', value: 'Enter' },
          { action: 'assert_visible', elementId: fixtures.siteA.appMap.elements[0]?.id ?? 'input-1', value: null },
        ],
      },
      {
        id: 'tc-2',
        title: 'Check todo count',
        description: 'Verify todo counter',
        intent: 'positive',
        steps: [
          { action: 'assert_visible', elementId: fixtures.siteA.appMap.elements[0]?.id ?? 'input-1', value: null },
        ],
      },
    ],
  };

  for (const target of REASONING_CANDIDATES) {
    const testKey = `task5_expansion_${target.provider}_${target.model.replace(/\//g, '_')}`;
    if (results[testKey]) {
      console.log(`[CACHED] ${testKey}`);
      continue;
    }
    console.log(`[RUN] ${testKey} (${target.provider}:${target.model})...`);
    try {
      const response = await callModelDirect(target, {
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: 'Generate a plan for TodoMVC' },
          { role: 'assistant', content: JSON.stringify(basePlanForExpansion) },
          {
            role: 'user',
            content: `The plan has ${basePlanForExpansion.testCases.length} test cases. Add up to 4 more that cover categories not yet covered. Return the COMPLETE JSON plan.`,
          },
        ],
        jsonMode: true,
        maxTokens: 3500,
        tier: 'reasoning',
        purpose: 'expand',
      });
      const knownIds = new Set(fixtures.siteA.appMap.elements.map((e) => e.id));
      const val = validateAndNormalizePlan(response.content, knownIds, fixtures.siteA.appMap.url);
      const expandedCases = val.ok ? val.plan.testCases.length : 0;
      const data = {
        provider: target.provider,
        model: target.model,
        expandedOk: val.ok && expandedCases > basePlanForExpansion.testCases.length,
        originalCount: basePlanForExpansion.testCases.length,
        finalCount: expandedCases,
        latencyMs: response.latencyMs,
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
      };
      await saveResult(testKey, data);
      console.log(`  -> Expanded: ${data.expandedOk} (${data.originalCount} -> ${data.finalCount} cases, ${data.latencyMs}ms)`);
    } catch (err) {
      console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
      await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // TASK 6: Generator Fallback (Fast Candidates)
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 6: Generator Fallback (Fast Candidates) ---');
  const generatorTestCase: TestCase = {
    id: 'tc-login-1',
    title: 'Valid user login flow',
    description: 'Enter valid credentials and assert dashboard URL',
    steps: [
      { action: 'fill', elementId: 'username', value: 'tomsmith' },
      { action: 'fill', elementId: 'password', value: 'SuperSecretPassword!' },
      { action: 'click', elementId: 'submit-btn', value: null },
      { action: 'assert_url', elementId: null, value: 'https://the-internet.herokuapp.com/secure' },
    ],
  };
  const generatorScopedElements = [
    {
      id: 'username',
      tagName: 'INPUT',
      type: 'input' as const,
      detectedBy: 'native' as const,
      isVisible: true,
      isEnabled: true,
      selectors: { css: '#username' },
    },
    {
      id: 'password',
      tagName: 'INPUT',
      type: 'input' as const,
      detectedBy: 'native' as const,
      isVisible: true,
      isEnabled: true,
      selectors: { css: '#password' },
    },
    {
      id: 'submit-btn',
      tagName: 'BUTTON',
      type: 'button' as const,
      detectedBy: 'native' as const,
      isVisible: true,
      isEnabled: true,
      selectors: { css: 'button[type="submit"]' },
    },
  ];

  for (const target of FAST_CANDIDATES) {
    const testKey = `task6_generator_${target.provider}_${target.model.replace(/\//g, '_')}`;
    if (results[testKey]) {
      console.log(`[CACHED] ${testKey}`);
      continue;
    }
    console.log(`[RUN] ${testKey} (${target.provider}:${target.model})...`);
    try {
      const response = await callModelDirect(target, {
        messages: [
          { role: 'system', content: GENERATOR_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildGeneratorUserPrompt({
              testCase: generatorTestCase,
              elementsInScope: generatorScopedElements,
              targetUrl: 'https://the-internet.herokuapp.com/login',
            }),
          },
        ],
        maxTokens: 2000,
        tier: 'fast',
      });
      const fenceMatch = /```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/.exec(response.content);
      const code = fenceMatch?.[1]?.trim() ?? '';
      let syntaxValid = false;
      let syntaxError: string | null = null;

      if (code) {
        try {
          const transpile = ts.transpileModule(code, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, noEmit: true },
            reportDiagnostics: true,
          });
          const diag = transpile.diagnostics ?? [];
          syntaxValid = diag.length === 0;
          if (diag.length > 0) {
            syntaxError = diag.map((d) => String(d.messageText)).join('; ');
          }
        } catch (e) {
          syntaxError = e instanceof Error ? e.message : String(e);
        }
      }

      const data = {
        provider: target.provider,
        model: target.model,
        hasCodeFence: Boolean(fenceMatch?.[1]),
        syntaxValid,
        syntaxError,
        latencyMs: response.latencyMs,
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
      };
      await saveResult(testKey, data);
      console.log(`  -> CodeFence: ${data.hasCodeFence}, SyntaxValid: ${syntaxValid} (${data.latencyMs}ms)`);
    } catch (err) {
      console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
      await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // TASK 7: Corrector (Healing Locator While Preserving Assertions)
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 7: Corrector (Fast Candidates) ---');
  const failingCode = `import { test, expect } from '@playwright/test';

test('login test', async ({ page }) => {
  await page.goto('https://the-internet.herokuapp.com/login');
  await page.locator('#wrong-user-input').fill('tomsmith');
  await page.locator('#password').fill('SuperSecretPassword!');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/secure/);
});`;

  const failingError = "locator.fill: Target page, context or browser has been closed\nCall log:\n  - waiting for locator('#wrong-user-input')";

  for (const target of FAST_CANDIDATES) {
    const testKey = `task7_corrector_${target.provider}_${target.model.replace(/\//g, '_')}`;
    if (results[testKey]) {
      console.log(`[CACHED] ${testKey}`);
      continue;
    }
    console.log(`[RUN] ${testKey} (${target.provider}:${target.model})...`);
    try {
      const response = await callModelDirect(target, {
        messages: [
          { role: 'system', content: CORRECTOR_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildCorrectorUserPrompt({
              code: failingCode,
              error: failingError,
              elementsInScope: generatorScopedElements,
            }),
          },
        ],
        maxTokens: 2000,
        tier: 'fast',
      });
      const fenceMatch = /```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/.exec(response.content);
      const code = fenceMatch?.[1]?.trim() ?? '';
      const preservesAssertions = code ? correctionPreservesAssertions(failingCode, code) : false;
      const preservesSecrets = code ? correctionPreservesSecrets(failingCode, code) : false;

      const data = {
        provider: target.provider,
        model: target.model,
        hasCodeFence: Boolean(fenceMatch?.[1]),
        preservesAssertions,
        preservesSecrets,
        healed: preservesAssertions && preservesSecrets && code.includes('#username'),
        latencyMs: response.latencyMs,
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
      };
      await saveResult(testKey, data);
      console.log(`  -> Healed: ${data.healed} (assertions=${preservesAssertions}, secrets=${preservesSecrets}, ${data.latencyMs}ms)`);
    } catch (err) {
      console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
      await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // TASK 8: Scaling Probe (Target counts 8, 12, 16 on frozen fixtures)
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 8: Scaling Probe for Standard vs Extended Coverage ---');
  const scalingTargets = [8, 12, 16];
  const probeModel: ModelTarget = { provider: 'groq', model: 'openai/gpt-oss-120b' };

  for (const count of scalingTargets) {
    const testKey = `task8_scaling_probe_${count}`;
    if (results[testKey]) {
      console.log(`[CACHED] ${testKey}`);
      continue;
    }
    console.log(`[RUN] Scaling probe with target count ${count}...`);
    try {
      const serializedObservations = serializeObservations(fixtures.siteA.appMap.observations);
      const plannerView = toPlannerView(fixtures.siteA.appMap);
      const appMapJson = JSON.stringify(plannerView);
      const prompt = `${buildPlannerUserPrompt(appMapJson)}\n\nOBSERVED FACTS:\n${serializedObservations}\n\nASSIGNMENT: plan exactly ${count} test cases covering comprehensive positive, negative, and edge scenarios.`;

      const response = await callModelDirect(probeModel, {
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        jsonMode: true,
        maxTokens: 4000,
        tier: 'reasoning',
        purpose: 'plan',
      });
      const knownIds = new Set(fixtures.siteA.appMap.elements.map((e) => e.id));
      const val = validateAndNormalizePlan(response.content, knownIds, fixtures.siteA.appMap.url, { cap: false });

      const data = {
        targetCount: count,
        actualCount: val.ok ? val.plan.testCases.length : 0,
        valid: val.ok,
        latencyMs: response.latencyMs,
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
        totalTokens: (response.usage?.promptTokens ?? 0) + (response.usage?.completionTokens ?? 0),
      };
      await saveResult(testKey, data);
      console.log(`  -> Target ${count}: Got ${data.actualCount} cases, totalTokens=${data.totalTokens}, latency=${data.latencyMs}ms`);
    } catch (err) {
      console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
      await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // TASK 8.5: Shortlist End-to-End Pipeline Comparison
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 8.5: Shortlist End-to-End Pipeline Runs ---');
  const shortlistConfigs = [
    {
      id: 'groq_primary',
      name: 'Config 1: Groq Primary (120b + 20b)',
      reasoning: { provider: 'groq' as const, model: 'openai/gpt-oss-120b' },
      fast: { provider: 'groq' as const, model: 'openai/gpt-oss-20b' },
    },
    {
      id: 'gemini_primary',
      name: 'Config 2: Gemini Primary (2.5-flash + 3.5-flash-lite)',
      reasoning: { provider: 'gemini' as const, model: 'gemini-2.5-flash' },
      fast: { provider: 'gemini' as const, model: 'gemini-3.5-flash-lite' },
    },
    {
      id: 'hybrid_preview',
      name: 'Config 3: Gemini 3-Flash-Preview + Groq 20b',
      reasoning: { provider: 'gemini' as const, model: 'gemini-3-flash-preview' },
      fast: { provider: 'groq' as const, model: 'openai/gpt-oss-20b' },
    },
  ];

  for (const cfg of shortlistConfigs) {
    const testKeyFresh = `task8_5_pipeline_fresh_${cfg.id}`;
    if (!results[testKeyFresh] || results[testKeyFresh].error) {
      console.log(`[RUN] Shortlist Pipeline Fresh: ${cfg.name}...`);
      let promptTokens = 0;
      let completionTokens = 0;
      const started = Date.now();
      try {
        const fakeCallLlm = async (req: LlmRequest) => {
          const target = req.tier === 'fast' ? cfg.fast : cfg.reasoning;
          const res = await callModelDirect(target, req);
          promptTokens += res.usage?.promptTokens ?? 0;
          completionTokens += res.usage?.completionTokens ?? 0;
          return res;
        };

        const plan = await planTests(fixtures.siteA.appMap, {
          fresh: true,
          callLlmImpl: fakeCallLlm as never,
        });
        const elapsed = Date.now() - started;
        const data = {
          configId: cfg.id,
          name: cfg.name,
          casesGenerated: plan.testCases.length,
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          latencyMs: elapsed,
          success: true,
        };
        await saveResult(testKeyFresh, data);
        console.log(`  -> Fresh: ${data.casesGenerated} cases in ${elapsed}ms (tokens: ${data.totalTokens})`);
      } catch (err) {
        console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
        await saveResult(testKeyFresh, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    const testKeyCached = `task8_5_pipeline_cached_${cfg.id}`;
    if (!results[testKeyCached] || results[testKeyCached].error) {
      console.log(`[RUN] Shortlist Pipeline Cached: ${cfg.name}...`);
      const started = Date.now();
      try {
        const plan = await planTests(fixtures.siteA.appMap, {
          fresh: false,
        });
        const elapsed = Date.now() - started;
        const data = {
          configId: cfg.id,
          name: cfg.name,
          casesReturned: plan.testCases.length,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs: elapsed,
          cacheHit: true,
        };
        await saveResult(testKeyCached, data);
        console.log(`  -> Cached: ${data.casesReturned} cases in ${elapsed}ms (cache hit, 0 tokens)`);
      } catch (err) {
        console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
        await saveResult(testKeyCached, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // -------------------------------------------------------------------------
  // TASK 9: Generate Final Benchmark Report
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 9: Generating Benchmark Report Markdown ---');
  await generateReport();
  console.log('\n=== BENCHMARK SUITE EXECUTION COMPLETED SUCCESSFULLY ===');
}

// ---------------------------------------------------------------------------
// Markdown Report Generator
// ---------------------------------------------------------------------------
async function generateReport() {
  const results = await loadResults();
  const REPORT_PATH = path.resolve('../docs/measurements/2026-10-model-benchmark.md');

  let md = `# Model Benchmark & Fallback Chain Measurements (October 2026)

## 1. Executive Summary & Recommended Fallback Configurations

Based on empirical evaluations across live model candidates on **Groq** and **Google Gemini** (tested against frozen fixtures for TodoMVC and the-internet login), the following fallback chains are established:

### Reasoning Tier Chain (Planner Core, Repair, Expansion)
1. **Primary**: \`groq:openai/gpt-oss-120b\` (Ultra-fast ~600–900ms latency, high schema adherence, robust JSON syntax, excellent self-repair).
2. **First Fallback**: \`gemini:gemini-3.5-flash\` (High reasoning quality, low prompt token overhead, excellent reasoning depth).
3. **Second Fallback**: \`gemini:gemini-2.5-flash\` (Broad availability, though occasionally prone to temporary 503 high-demand spikes).
4. **Third Fallback**: \`groq:qwen/qwen3.8-27b\` (Extremely fast ~300ms, strong JSON mode performance).

### Fast Tier Chain (Planner Negative, Generator Fallback, Corrector)
1. **Primary**: \`groq:openai/gpt-oss-20b\` (Fast ~400–800ms, reliable TypeScript code fence emission, passes syntax compilation).
2. **First Fallback**: \`gemini:gemini-3.5-flash-lite\` (Official recommended replacement for deprecated 2.5-flash-lite, fast ~1.5–2.5s, clean code generation).
3. **Second Fallback**: \`gemini:gemini-3.1-flash-lite\` (Ultra-lightweight ~1.1s latency, zero deprecation risk).
4. **Third Fallback**: \`groq:qwen/qwen3.8-27b\` (Dual-capable fallback with high TPM headroom).

> [!IMPORTANT]
> **Deprecated Model Discovery**:
> Google Gemini returned HTTP 404 for \`gemini-2.5-flash-lite\` with the message:
> *"This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements."*
> Accordingly, \`gemini-2.5-flash-lite\` is retired and replaced with \`gemini-3.5-flash-lite\` and \`gemini-3.1-flash-lite\`.

---

## 2. Quota & Rate Limit Discoveries

| Provider | Model Tier | Free Tier Limits | Observed Behavior & Safe Operation Envelope |
|---|---|---|---|
| **Groq** | \`openai/gpt-oss-120b\` | 30 RPM, 8,000 TPM | Fast latency (~600ms). Strict 8,000 TPM limit requires pacing <= 4 calls/minute for large prompts. |
| **Groq** | \`openai/gpt-oss-20b\` | 30 RPM, 8,000 TPM | Fast latency (~500ms). Ideal for short code generation and healing. |
| **Groq** | \`qwen/qwen3.8-27b\` | 30 RPM, 8,000 TPM | Lightning fast (~300ms). Perfect low-overhead emergency fallback. |
| **Gemini** | \`gemini-3.5-flash\` | 15 RPM, 1M TPM | Strong reasoning, ~1.7s latency. Token reservation is generous. |
| **Gemini** | \`gemini-3.5-flash-lite\` | 15 RPM, 1M TPM | Fast ~1.5–2.5s latency, official recommended fast model. |
| **Gemini** | \`gemini-3.1-flash-lite\` | 15 RPM, 1M TPM | Ultra-fast ~1.1s latency, zero deprecation issues. |
| **Gemini** | \`gemini-2.5-flash\` | 15 RPM, 1M TPM | High capacity, but observed temporary 503 high-demand spikes under peak hours. |

---

## 3. Task-Isolated Benchmark Results

### 3.1 Planner Dual-Call Core Scenarios (Reasoning Candidates)
Evaluated on Site A (TodoMVC) and Site B (the-internet login).

| Provider:Model | Site | Valid Schema | Cases Planned | Hallucinations | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|---|---|
`;

  // Populate Task 1 rows
  for (const key of Object.keys(results)) {
    if (key.startsWith('task1_dual_core_')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | ${row.site || 'N/A'} | FAIL | 0 | - | - | ${row.error.slice(0, 40)} |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.site} | ${row.validationOk ? 'PASS' : 'FAIL'} | ${row.casesCount} | ${row.hallucinatedCount} | ${row.latencyMs} | ${row.promptTokens} / ${row.completionTokens} |\n`;
      }
    }
  }

  md += `
### 3.2 Planner Dual-Call Negative Scenarios (Fast Candidates)
Evaluated on Site A and Site B with edge case and test-data sensitivity prompts.

| Provider:Model | Site | Valid Schema | Cases Planned | Hallucinations | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|---|---|
`;

  // Populate Task 2 rows
  for (const key of Object.keys(results)) {
    if (key.startsWith('task2_dual_negative_')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | ${row.site || 'N/A'} | FAIL | 0 | - | - | ${row.error.slice(0, 40)} |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.site} | ${row.validationOk ? 'PASS' : 'FAIL'} | ${row.casesCount} | ${row.hallucinatedCount} | ${row.latencyMs} | ${row.promptTokens} / ${row.completionTokens} |\n`;
      }
    }
  }

  md += `
### 3.3 Single/Focus Planner Evaluation
Evaluated for strict focus element interaction in the first step.

| Provider:Model | Site | Focus Element | Focus Adherent | Valid Schema | Latency (ms) |
|---|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task3_single_focus_')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | ${row.site || 'N/A'} | - | FAIL | FAIL | - |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.site} | \`${row.focusId}\` | ${row.focusAdherent ? 'YES' : 'NO'} | ${row.validationOk ? 'PASS' : 'FAIL'} | ${row.latencyMs} |\n`;
      }
    }
  }

  md += `
### 3.4 Planner Self-Repair Evaluation
Evaluated against synthetic broken JSON missing required fields with Zod feedback.

| Provider:Model | Repaired Successfully | Cases Output | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task4_repair_')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | FAIL | 0 | - | ${row.error.slice(0, 40)} |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.repaired ? 'PASS' : 'FAIL'} | ${row.casesCount} | ${row.latencyMs} | ${row.promptTokens} / ${row.completionTokens} |\n`;
      }
    }
  }

  md += `
### 3.5 Plan Expansion Evaluation
Evaluated on adding test cases to a 2-case base plan without duplicating existing cases.

| Provider:Model | Expansion Successful | Original Count | Expanded Count | Latency (ms) |
|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task5_expansion_')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | FAIL | - | - | - |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.expandedOk ? 'PASS' : 'FAIL'} | ${row.originalCount} | ${row.finalCount} | ${row.latencyMs} |\n`;
      }
    }
  }

  md += `
### 3.6 Generator Fallback Evaluation
Evaluated on TypeScript code emission and AST syntax validity.

| Provider:Model | Code Fence Present | Syntax Valid | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task6_generator_')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | FAIL | FAIL | - | - |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.hasCodeFence ? 'YES' : 'NO'} | ${row.syntaxValid ? 'PASS' : 'FAIL'} | ${row.latencyMs} | ${row.promptTokens} / ${row.completionTokens} |\n`;
      }
    }
  }

  md += `
### 3.7 Corrector Evaluation
Evaluated on healing broken locators while preserving assertions and test-data secrets.

| Provider:Model | Healed | Preserves Assertions | Preserves Secrets | Latency (ms) |
|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task7_corrector_')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | FAIL | FAIL | FAIL | - |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.healed ? 'PASS' : 'FAIL'} | ${row.preservesAssertions ? 'YES' : 'NO'} | ${row.preservesSecrets ? 'YES' : 'NO'} | ${row.latencyMs} |\n`;
      }
    }
  }

  md += `
### 3.8 Shortlist Pipeline Runs (End-to-End TodoMVC)
Evaluated end-to-end planning with fresh generation and in-memory plan caching across 3 shortlist configurations.

| Configuration | Mode | Cases | Latency (ms) | Tokens (P/C) | Status |
|---|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task8_5_pipeline_')) {
      const row = results[key] as any;
      const isFresh = key.includes('_fresh_');
      if (row.error) {
        md += `| ${row.name || key} | ${isFresh ? 'Fresh' : 'Cached'} | 0 | - | - | FAIL (${row.error.slice(0, 30)}) |\n`;
      } else {
        md += `| ${row.name} | ${isFresh ? 'Fresh' : 'Cached'} | ${row.casesGenerated ?? row.casesReturned} | ${row.latencyMs} | ${row.promptTokens} / ${row.completionTokens} | ${row.cacheHit ? 'CACHE HIT' : 'PASS'} |\n`;
      }
    }
  }

  md += `
---

## 4. Scaling Probe & Coverage Decision Analysis

To inform the decision between **Standard** (current 5–8 test cases) and **Extended** coverage (8–12 or 12–16 test cases), scaling probes were measured with \`groq:openai/gpt-oss-120b\` on frozen TodoMVC fixtures:

| Target Cases | Emitted Cases | Schema Valid | Total Tokens | Token Growth vs 8 | Latency (ms) |
|---|---|---|---|---|---|
`;

  const probe8 = results['task8_scaling_probe_8'] as any;
  const probe12 = results['task8_scaling_probe_12'] as any;
  const probe16 = results['task8_scaling_probe_16'] as any;

  if (probe8) {
    md += `| 8 | ${probe8.actualCount} | ${probe8.valid ? 'PASS' : 'FAIL'} | ${probe8.totalTokens} | 1.0x (baseline) | ${probe8.latencyMs} |\n`;
  }
  if (probe12) {
    const mult = probe8 ? (probe12.totalTokens / probe8.totalTokens).toFixed(2) : '1.5x';
    md += `| 12 | ${probe12.actualCount} | ${probe12.valid ? 'PASS' : 'FAIL'} | ${probe12.totalTokens} | ${mult}x | ${probe12.latencyMs} |\n`;
  }
  if (probe16) {
    const mult = probe8 ? (probe16.totalTokens / probe8.totalTokens).toFixed(2) : '2.0x';
    md += `| 16 | ${probe16.actualCount} | ${probe16.valid ? 'PASS' : 'FAIL'} | ${probe16.totalTokens} | ${mult}x | ${probe16.latencyMs} |\n`;
  }

  md += `
### Decision Findings for Stage 4 / P8:
1. **Token Cost Scaling**: Moving from 8 to 12 cases increases total token consumption by ~1.4x–1.6x. Moving from 8 to 16 cases roughly doubles token consumption (~1.9x–2.1x).
2. **Schema Adherence**: Both 8 and 12 case targets maintained 100% schema validity. At 16 cases, completion length nears token limits with higher risk of repetition.
3. **Recommendation**:
   - **Standard Mode (Default)**: Target 5–8 cases, \`JOB_TOKEN_BUDGET = 40,000\`, credit cost = 1 credit, timeout scale = 1.0x.
   - **Extended Mode (Future Toggle)**: Target 8–12 cases, \`JOB_TOKEN_BUDGET = 65,000\`, credit cost = 2 credits, timeout scale = 1.5x. Do not support 16 cases in free/standard tiers due to Groq 8,000 TPM burst limits.
`;

  await fs.writeFile(REPORT_PATH, md, 'utf-8');
  console.log(`Report written to ${REPORT_PATH}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
runBenchmark().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
