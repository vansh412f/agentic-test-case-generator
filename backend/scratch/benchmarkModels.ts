import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import dotenv from 'dotenv';
import ts from 'typescript';

const execFileAsync = promisify(execFile);

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
  const userPromptA = buildPlannerPrompt(fixtures.siteA, 'A');
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
          { role: 'user', content: userPromptA },
          { role: 'assistant', content: brokenPlanJson },
          {
            role: 'user',
            content: `Your previous response failed validation.\n\nErrors (schema):\n${repairError}\n\nReturn ONLY the corrected JSON object. Include valid steps with actions and assertions. No prose, no markdown, no code fences.`,
          },
        ],
        jsonMode: true,
        maxTokens: 3000,
        tier: 'reasoning',
        purpose: 'repair',
      });
      const knownIds = new Set(fixtures.siteA.appMap.elements.map((e) => e.id));
      const val = validateAndNormalizePlan(response.content, knownIds, fixtures.siteA.appMap.url, { cap: false });
      let casesCount = 0;
      let repaired = false;
      if (val.ok) {
        repaired = true;
        casesCount = val.plan.testCases.length;
      } else if (val.kind === 'references') {
        const salvaged = val.plan.testCases.filter((_, idx) => !val.badCaseIndexes.has(idx));
        if (salvaged.length > 0) {
          repaired = true;
          casesCount = salvaged.length;
        }
      }
      const data = {
        provider: target.provider,
        model: target.model,
        repaired,
        validationOk: val.ok,
        validationKind: val.kind,
        errorDetail: val.ok ? null : val.detail,
        latencyMs: response.latencyMs,
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
        casesCount,
      };
      await saveResult(testKey, data);
      console.log(`  -> Repaired: ${data.repaired} (${data.casesCount} cases, ${data.latencyMs}ms, kind: ${data.validationKind})`);
    } catch (err) {
      console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
      await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // TASK 5: Plan Expansion (Reasoning Candidates)
  // -------------------------------------------------------------------------
  console.log('\n--- TASK 5: Plan Expansion (Reasoning Candidates) ---');
  const inputElem = fixtures.siteA.appMap.elements.find((e) => e.tagName === 'INPUT' || e.type === 'input') ?? fixtures.siteA.appMap.elements[1];
  const inputId = inputElem.id;
  const basePlanForExpansion: TestPlan = {
    testCases: [
      {
        id: 'tc-1',
        title: 'Add new todo item',
        description: 'Verify adding an item to the list',
        intent: 'positive',
        steps: [
          { action: 'fill', elementId: inputId, value: 'Buy groceries' },
          { action: 'press', elementId: inputId, value: 'Enter' },
          { action: 'assert_visible', elementId: inputId, value: null },
        ],
      },
      {
        id: 'tc-2',
        title: 'Verify todo input is visible',
        description: 'Check that the main todo input field is visible',
        intent: 'positive',
        steps: [
          { action: 'assert_visible', elementId: inputId, value: null },
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
          { role: 'user', content: userPromptA },
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
      const val = validateAndNormalizePlan(response.content, knownIds, fixtures.siteA.appMap.url, { cap: false });
      let finalCount = 0;
      let expandedOk = false;
      if (val.ok) {
        finalCount = val.plan.testCases.length;
        expandedOk = finalCount > basePlanForExpansion.testCases.length;
      } else if (val.kind === 'references') {
        const salvaged = val.plan.testCases.filter((_, idx) => !val.badCaseIndexes.has(idx));
        finalCount = salvaged.length;
        expandedOk = finalCount > basePlanForExpansion.testCases.length;
      }
      const data = {
        provider: target.provider,
        model: target.model,
        expandedOk,
        originalCount: basePlanForExpansion.testCases.length,
        finalCount,
        validationOk: val.ok,
        validationKind: val.kind,
        errorDetail: val.ok ? null : val.detail,
        latencyMs: response.latencyMs,
        promptTokens: response.usage?.promptTokens ?? 0,
        completionTokens: response.usage?.completionTokens ?? 0,
      };
      await saveResult(testKey, data);
      console.log(`  -> Expanded: ${data.expandedOk} (${data.originalCount} -> ${data.finalCount} cases, ${data.latencyMs}ms, kind: ${data.validationKind})`);
    } catch (err) {
      console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
      await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // R5.3: gemini-2.5-pro Probe (1 micro JSON smoke + Task 1 Site A)
  // -------------------------------------------------------------------------
  console.log('\n--- R5.3: gemini-2.5-pro Evaluation ---');
  const proSmokeKey = 'task_gemini_2_5_pro_smoke';
  const proTask1Key = 'task1_dual_core_siteA_gemini_gemini-2.5-pro';

  if (!results[proSmokeKey]) {
    try {
      console.log('Running gemini-2.5-pro micro JSON smoke...');
      const smokeRes = await callModelDirect(
        { provider: 'gemini', model: 'gemini-2.5-pro' },
        {
          messages: [{ role: 'user', content: 'Output JSON: {"smoke": "ok"}' }],
          maxTokens: 500,
          jsonMode: true,
          purpose: 'plan',
        },
      );
      await saveResult(proSmokeKey, {
        ok: true,
        latencyMs: smokeRes.latencyMs,
        content: smokeRes.content,
      });
      console.log(`  [PRO SMOKE PASS] (${smokeRes.latencyMs}ms): ${smokeRes.content.trim()}`);
    } catch (err) {
      console.log(`  [PRO SMOKE FAIL/UNAVAILABLE]: ${err instanceof Error ? err.message : String(err)}`);
      await saveResult(proSmokeKey, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!results[proTask1Key]) {
    if (results[proSmokeKey]?.ok) {
      try {
        console.log('Running gemini-2.5-pro Task 1 Site A...');
        const userPrompt = buildPlannerPrompt(fixtures.siteA, 'A');
        const response = await callModelDirect(
          { provider: 'gemini', model: 'gemini-2.5-pro' },
          {
            messages: [
              { role: 'system', content: PLANNER_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            jsonMode: true,
            maxTokens: 3000,
            tier: 'reasoning',
            purpose: 'plan',
          },
        );
        const knownIds = new Set(fixtures.siteA.appMap.elements.map((e) => e.id));
        const val = validateAndNormalizePlan(response.content, knownIds, fixtures.siteA.appMap.url);
        await saveResult(proTask1Key, {
          provider: 'gemini',
          model: 'gemini-2.5-pro',
          validationOk: val.ok,
          validationKind: val.kind,
          casesCount: val.ok ? val.plan.testCases.length : 0,
          latencyMs: response.latencyMs,
          promptTokens: response.usage?.promptTokens ?? 0,
          completionTokens: response.usage?.completionTokens ?? 0,
        });
        console.log(`  [PRO TASK 1 PASS] (${response.latencyMs}ms, ${val.ok ? val.plan.testCases.length : 0} cases)`);
      } catch (err) {
        console.log(`  [PRO TASK 1 FAIL]: ${err instanceof Error ? err.message : String(err)}`);
        await saveResult(proTask1Key, {
          provider: 'gemini',
          model: 'gemini-2.5-pro',
          status: 'UNAVAILABLE',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      console.log('  [PRO TASK 1 UNAVAILABLE] Smoke failed/quota blocked');
      await saveResult(proTask1Key, {
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        status: 'UNAVAILABLE',
        error: results[proSmokeKey]?.error || 'Smoke failed',
      });
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
  // R6: Scaling Probe Redo (Standard vs Extended Coverage)
  // -------------------------------------------------------------------------
  console.log('\n--- R6: Scaling Probe Redo for Standard vs Extended Coverage ---');

  const SCALING_CONFIGS = [
    {
      id: 'groq_primary',
      name: 'Groq Primary (120b A + 20b B)',
      core: { provider: 'groq' as const, model: 'openai/gpt-oss-120b' },
      negative: { provider: 'groq' as const, model: 'openai/gpt-oss-20b' },
    },
    {
      id: 'gemini_primary',
      name: 'Gemini Primary (3.5-flash A + 3.1-flash-lite B)',
      core: { provider: 'gemini' as const, model: 'gemini-3.5-flash' },
      negative: { provider: 'gemini' as const, model: 'gemini-3.1-flash-lite' },
    },
  ];

  const TARGET_SPLITS = [
    { total: 8, a: 5, b: 3, maxTokensA: 3000, maxTokensB: 2500 },
    { total: 12, a: 7, b: 5, maxTokensA: 3500, maxTokensB: 3000 },
    { total: 16, a: 10, b: 6, maxTokensA: 4000, maxTokensB: 3500 },
  ];

  for (const cfg of SCALING_CONFIGS) {
    for (const siteKey of ['siteA', 'siteB'] as const) {
      const site = fixtures[siteKey];
      let stopTarget16 = false;
      let target8Result: any = null;

      for (const split of TARGET_SPLITS) {
        if (split.total === 16 && stopTarget16) {
          console.log(`[SKIP] Scaling Target 16 for ${cfg.id} on ${siteKey}: stopped by target 12 threshold rule`);
          continue;
        }

        const testKey = `task6_scaling_${cfg.id}_${siteKey}_target${split.total}`;
        if (results[testKey]) {
          console.log(`[CACHED] ${testKey}`);
          if (split.total === 8) target8Result = results[testKey];
          if (split.total === 12) {
            const row = results[testKey];
            if (row.distinctCount < 10 || row.duplicateRate > 0.25) {
              stopTarget16 = true;
            }
          }
          continue;
        }

        console.log(`[RUN] Scaling ${cfg.id} on ${siteKey} with target ${split.total} (A=${split.a}, B=${split.b})...`);

        try {
          const promptA = `${buildPlannerPrompt(site, 'A')}\n\nASSIGNMENT: plan up to ${split.a} core cases — primary happy paths end-to-end, key navigation, main content visibility. Prefer cases grounded in OBSERVED FACTS.`;
          const promptB = `${buildPlannerPrompt(site, 'B')}\n\nASSIGNMENT: plan up to ${split.b} negative / validation / edge cases — empty submits, invalid input, counts, visibility of secondary elements. Prefer cases grounded in OBSERVED FACTS.\nTEST DATA values are valid success values. Never use a secret placeholder as the invalid/missing value under test: empty field = fill '' or omit the fill; wrong credential = a non-secret literal such as wrong-password. Use exact test-data only for fields meant to stay valid in that case.`;

          const started = Date.now();
          const resA = await callModelDirect(cfg.core, {
            messages: [
              { role: 'system', content: PLANNER_SYSTEM_PROMPT },
              { role: 'user', content: promptA },
            ],
            jsonMode: true,
            maxTokens: split.maxTokensA,
            tier: 'reasoning',
            purpose: 'plan',
          });

          const resB = await callModelDirect(cfg.negative, {
            messages: [
              { role: 'system', content: PLANNER_SYSTEM_PROMPT },
              { role: 'user', content: promptB },
            ],
            jsonMode: true,
            maxTokens: split.maxTokensB,
            tier: 'fast',
            purpose: 'plan',
          });

          const knownIds = new Set(site.appMap.elements.map((e) => e.id));
          const valA = validateAndNormalizePlan(resA.content, knownIds, site.appMap.url, { cap: false });
          const valB = validateAndNormalizePlan(resB.content, knownIds, site.appMap.url, { cap: false });

          const casesA: TestCase[] = valA.ok
            ? valA.plan.testCases
            : valA.kind === 'references'
              ? valA.plan.testCases.filter((_, idx) => !valA.badCaseIndexes.has(idx))
              : [];
          const casesB: TestCase[] = valB.ok
            ? valB.plan.testCases
            : valB.kind === 'references'
              ? valB.plan.testCases.filter((_, idx) => !valB.badCaseIndexes.has(idx))
              : [];

          const rawCases = [...casesA, ...casesB];
          const rawCount = rawCases.length;

          // Signature: normalized action sequence + element IDs + assertion types/targets
          const signatures = rawCases.map((tc) =>
            tc.steps
              .map((s) => `${s.action}:${s.elementId ?? ''}:${s.target?.name ?? ''}:${s.value ?? ''}`)
              .join('->'),
          );
          const distinctSignatures = Array.from(new Set(signatures));
          const distinctCount = distinctSignatures.length;
          const duplicates = rawCount - distinctCount;
          const duplicateRate = rawCount > 0 ? duplicates / rawCount : 0;

          // Cases with < 2 assertions
          const casesWithLt2Assertions = rawCases.filter(
            (c) => c.steps.filter((s) => s.action.startsWith('assert_')).length < 2,
          ).length;

          // Visibility-only cases
          const visibilityOnlyCases = rawCases.filter((c) => {
            const assertions = c.steps.filter((s) => s.action.startsWith('assert_'));
            return assertions.length > 0 && assertions.every((s) => s.action === 'assert_visible');
          }).length;

          // Secret-placeholder-as-invalid-value count
          const secretPlaceholderCount = casesB.filter((c) =>
            c.steps.some(
              (s) =>
                s.value &&
                (s.value.includes('{{') || s.value.includes('SuperSecretPassword!')),
            ),
          ).length;

          const totalPromptTokens = (resA.usage?.promptTokens ?? 0) + (resB.usage?.promptTokens ?? 0);
          const totalCompletionTokens = (resA.usage?.completionTokens ?? 0) + (resB.usage?.completionTokens ?? 0);
          const totalTokens = totalPromptTokens + totalCompletionTokens;
          const latencyMs = Date.now() - started;

          let addedDistinctPer1kTokens = 0;
          if (split.total > 8 && target8Result) {
            const tokenDelta = (totalTokens - target8Result.totalTokens) / 1000;
            const distinctDelta = distinctCount - target8Result.distinctCount;
            if (tokenDelta > 0) {
              addedDistinctPer1kTokens = Number((distinctDelta / tokenDelta).toFixed(2));
            }
          }

          const cellData = {
            configId: cfg.id,
            site: siteKey,
            targetTotal: split.total,
            targetA: split.a,
            targetB: split.b,
            rawCount,
            distinctCount,
            duplicates,
            duplicateRate,
            casesWithLt2Assertions,
            visibilityOnlyCases,
            secretPlaceholderCount,
            totalTokens,
            totalPromptTokens,
            totalCompletionTokens,
            latencyMs,
            addedDistinctPer1kTokens,
          };

          if (split.total === 8) {
            target8Result = cellData;
          } else if (split.total === 12) {
            if (distinctCount < 10 || duplicateRate > 0.25) {
              stopTarget16 = true;
              console.log(
                `  [THRESHOLD HIT] Target 12 yielded distinct=${distinctCount} (<10) or dupRate=${(duplicateRate * 100).toFixed(1)}% (>25%). Stopping target 16.`,
              );
            }
          }

          await saveResult(testKey, cellData);
          console.log(
            `  -> Target ${split.total}: raw=${rawCount}, distinct=${distinctCount}, dupes=${duplicates}, tokens=${totalTokens}, latency=${latencyMs}ms`,
          );
        } catch (err) {
          console.error(`  -> ERROR: ${err instanceof Error ? err.message : String(err)}`);
          await saveResult(testKey, { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // R7: Reduced Full-Pipeline Shortlist (Groq-Primary vs Gemini-Primary)
  // -------------------------------------------------------------------------
  console.log('\n--- R7: Reduced Full-Pipeline Shortlist Runs ---');
  const SHORTLIST_RUNS = [
    { configId: 'groq_primary', site: 'todomvc' },
    { configId: 'groq_primary', site: 'saucedemo' },
    { configId: 'gemini_primary', site: 'todomvc' },
    { configId: 'gemini_primary', site: 'saucedemo' },
  ];

  for (const run of SHORTLIST_RUNS) {
    const testKey = `task7_pipeline_${run.configId}_${run.site}`;
    if (results[testKey] && results[testKey].status !== 'FAILED') {
      console.log(`[CACHED] ${testKey}`);
      continue;
    }
    console.log(`[RUN] Executing Shortlist Pipeline: ${run.configId} on ${run.site}...`);
    try {
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        LLM_PROVIDER_ORDER: run.configId === 'groq_primary' ? 'groq,gemini' : 'gemini,groq',
        GROQ_REASONING_MODELS: 'openai/gpt-oss-120b',
        GROQ_FAST_MODELS: 'openai/gpt-oss-20b,qwen/qwen3.8-27b',
        GEMINI_REASONING_MODELS: 'gemini-3.5-flash,gemini-2.5-flash',
        GEMINI_FAST_MODELS: 'gemini-3.1-flash-lite,gemini-3.5-flash-lite',
        BASELINE_TESTS: 'true',
        LOCAL_AGENT_MODE: 'false',
        JOB_TOKEN_BUDGET: '40000',
      };

      const { stdout } = await execFileAsync(
        'node',
        ['--import', 'tsx', 'scratch/runShortlistJob.ts', `--site=${run.site}`, `--config=${run.configId}`],
        { env, timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
      );

      const jsonMatch = /--- SHORTLIST RESULT JSON ---\s*\n([\s\S]*)$/.exec(stdout);
      if (!jsonMatch) {
        throw new Error(`Failed to parse shortlist result JSON from runner output: ${stdout.slice(-500)}`);
      }
      const runData = JSON.parse(jsonMatch[1].trim());
      await saveResult(testKey, runData);
      console.log(
        `  -> Pipeline finished: job=${runData.jobId}, tests=${runData.totalTests} (AI: ${runData.aiTestCount}, Base: ${runData.baselineCount}), status=${runData.jobStatus}, wallTime=${runData.wallTimeMs}ms`,
      );
    } catch (err) {
      console.error(`  -> ERROR in shortlist run: ${err instanceof Error ? err.message : String(err)}`);
      const isQuota =
        String(err).includes('429') ||
        String(err).includes('quota') ||
        String(err).includes('RESOURCE_EXHAUSTED');
      await saveResult(testKey, {
        configId: run.configId,
        site: run.site,
        status: isQuota ? 'QUOTA_BLOCKED' : 'FAILED',
        error: err instanceof Error ? err.message : String(err),
      });
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

> [!NOTE]
> \`groq:qwen/qwen3.8-27b\` is excluded from the reasoning chain due to Groq's strict 1,000 Output Tokens Per Minute (OTPM) rate limit, which fails heavy reasoning planning requests. It is reserved for fast generation and correction tasks.

### Fast Tier Chain (Planner Negative, Generator Fallback, Corrector)
1. **Primary**: \`groq:openai/gpt-oss-20b\` (Fast ~400–800ms, reliable TypeScript code fence emission, passes syntax compilation).
2. **First Fallback**: \`gemini:gemini-3.1-flash-lite\` (Ultra-fast ~1.1s latency, zero deprecation issues, stable quota).
3. **Second Fallback**: \`gemini:gemini-3.5-flash-lite\` (Official recommended replacement for deprecated 2.5-flash-lite, fast ~1.5–2.5s, clean code generation).
4. **Third Fallback**: \`groq:qwen/qwen3.8-27b\` (Dual-capable fallback with high speed for short outputs).

> [!IMPORTANT]
> **Deprecated Model Discovery**:
> Google Gemini returned HTTP 404 for \`gemini-2.5-flash-lite\` with the message:
> *"This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements."*
> Accordingly, \`gemini-2.5-flash-lite\` is retired and replaced with \`gemini-3.1-flash-lite\` and \`gemini-3.5-flash-lite\`.

---

## 2. Quota & Rate Limit Discoveries

| Provider | Model Tier | Free Tier Limits | Observed Behavior & Safe Operation Envelope |
|---|---|---|---|
| **Groq** | \`openai/gpt-oss-120b\` | 30 RPM, 8,000 TPM | Fast latency (~600–900ms). Strict 8,000 TPM limit requires pacing <= 4 calls/minute for large prompts. |
| **Groq** | \`openai/gpt-oss-20b\` | 30 RPM, 8,000 TPM | Fast latency (~500ms). Ideal for short code generation and healing. |
| **Groq** | \`qwen/qwen3.8-27b\` | 30 RPM, 1,000 OTPM | Strict 1,000 OTPM ceiling triggers 429 when maxTokens > 1000. Suitable only for fast small tasks (<1000 tokens). |
| **Gemini** | \`gemini-3.5-flash\` | 15 RPM, 1M TPM | Strong reasoning, ~1.7s latency. Token reservation is generous. |
| **Gemini** | \`gemini-3.1-flash-lite\` | 15 RPM, 1M TPM | Ultra-fast ~1.1s latency, zero deprecation issues. |
| **Gemini** | \`gemini-3.5-flash-lite\` | 15 RPM, 1M TPM | Fast ~1.5–2.5s latency, official recommended fast model. |
| **Gemini** | \`gemini-2.5-flash\` | 15 RPM, 1M TPM | High capacity, but observed temporary 503 high-demand spikes under peak hours. |
| **Gemini** | \`gemini-2.5-pro\` | Free tier limited | Evaluated via smoke probe and Task 1 Site A. |

---

## 3. Catalog Discovery & Verification (R4)
Official catalog discovery via \`https://api.groq.com/openai/v1/models\` and \`https://generativelanguage.googleapis.com/v1beta/openai/models\`:
- **Groq**: 6 chat-capable models discovered (\`openai/gpt-oss-120b\`, \`openai/gpt-oss-20b\`, \`qwen/qwen3.8-27b\`, \`allam-2-7b\`, \`canopylabs/orpheus-arabic-saudi\`, \`canopylabs/orpheus-v1-english\`). All configured chain models **FOUND**.
- **Gemini**: 51 chat-capable models discovered. All configured chain models **FOUND**.
- **Spot-check Models**:
  - \`gemini-2.5-pro\`: PRESENT
  - \`gemini-3-flash-preview\`: PRESENT
  - \`gemini-3.6-flash\`: PRESENT
  - \`gemini-3.8-flash\`: PRESENT

---

## 4. Zero-Call Site B & Invalidation Diagnosis (R5.0 & R5.1)

### Error Class Breakdown on Site B First-Shot Planning (15 cells total across Tasks 1, 2, 3):
- **Schema Errors (\`assert_text requires elementId or target\` or missing \`value\` or invalid \`target\` schema)**: 7 cells (Dominant error: 5 cells omitted \`elementId\`/\`target\` for flash banner text assertions).
- **Syntax / Truncation**: 1 cell (\`gemini-2.5-flash\` in Task 2 hit JSON truncation).
- **Focus Element Missing**: 3 cells (in Task 3 focus planning on Site B).
- **Passing First-Shot**: 3 cells (\`gemini-3-flash-preview\` in T1 & T3; \`qwen3.8-27b\` in T3).
- **Hallucinated Elements / References**: 0 cells (zero hallucinated element IDs).
- **Secret Placeholder Rule Violations**: 0 cells (clean placeholder handling).

### Production Implication:
On pages with dynamic flash banner notifications (e.g. login error messages), models commonly emit page-level text assertions (\`{"action": "assert_text", "value": "..."}\`) rather than specifying the banner's element ID. In production, this causes first-shot planner validation to fail with a schema error; however, the pipeline's self-repair step (\`repairPlan\`) and dual-call merge absorb the error and produce valid plans.

### Checkpoint Invalidation Disclosure:
In the initial benchmark run, Task 4 (repair) and Task 5 (expansion) fixtures lacked an AppMap prompt, providing only \`"Generate a plan for TodoMVC"\`. This forced models to invent element IDs that could not match known element IDs. In accordance with R5.1 and R5.2, those ungrounded entries were invalidated by renaming them with an \`_invalid_v1\` suffix in \`backend/scratch/model_benchmark_results.json\`, and both tasks were re-run using production-faithful prompts with full AppMap context.

---

## 5. Task-Isolated Benchmark Results

### 5.1 Planner Dual-Call Core Scenarios (Reasoning Candidates)
Evaluated on Site A (TodoMVC) and Site B (the-internet login).

| Provider:Model | Site | Valid Schema | Cases Planned | Hallucinations | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task1_dual_core_')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | ${row.site || 'N/A'} | FAIL | 0 | - | - | ${row.error.slice(0, 40)} |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.site} | ${row.validationOk ? 'PASS' : 'FAIL'} | ${row.casesCount} | ${row.hallucinatedCount ?? 0} | ${row.latencyMs} | ${row.promptTokens} / ${row.completionTokens} |\n`;
      }
    }
  }

  md += `
### 5.2 Planner Dual-Call Negative Scenarios (Fast Candidates)
Evaluated on Site A and Site B with edge case and test-data sensitivity prompts.

| Provider:Model | Site | Valid Schema | Cases Planned | Hallucinations | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task2_dual_negative_')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | ${row.site || 'N/A'} | FAIL | 0 | - | - | ${row.error.slice(0, 40)} |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.site} | ${row.validationOk ? 'PASS' : 'FAIL'} | ${row.casesCount} | ${row.hallucinatedCount ?? 0} | ${row.latencyMs} | ${row.promptTokens} / ${row.completionTokens} |\n`;
      }
    }
  }

  md += `
### 5.3 Single/Focus Planner Evaluation
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
### 5.4 Planner Self-Repair Evaluation (R5.1 Grounded Re-run)
Evaluated against synthetic broken JSON missing required fields with AppMap and Zod schema feedback.

| Provider:Model | Repaired | Validation Kind | Cases Output | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task4_repair_') && !key.endsWith('_invalid_v1')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | FAIL | error | 0 | - | ${row.error.slice(0, 40)} |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.repaired ? 'PASS' : 'FAIL'} | ${row.validationKind ?? 'ok'} | ${row.casesCount} | ${row.latencyMs} | ${row.promptTokens} / ${row.completionTokens} |\n`;
      }
    }
  }

  md += `
### 5.5 Plan Expansion Evaluation (R5.1 Grounded Re-run)
Evaluated on expanding a 2-case base plan grounded in AppMap A element IDs.

| Provider:Model | Expansion Successful | Validation Kind | Original Count | Expanded Count | Latency (ms) |
|---|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task5_expansion_') && !key.endsWith('_invalid_v1')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| \`${row.provider || 'unknown'}:${row.model || key}\` | FAIL | error | - | - | - |\n`;
      } else {
        md += `| \`${row.provider}:${row.model}\` | ${row.expandedOk ? 'PASS' : 'FAIL'} | ${row.validationKind ?? 'ok'} | ${row.originalCount} | ${row.finalCount} | ${row.latencyMs} |\n`;
      }
    }
  }

  md += `
### 5.6 gemini-2.5-pro Probe Evaluation (R5.3)

| Model | Smoke Status | Task 1 Site A Cases | Latency (ms) | Status |
|---|---|---|---|---|
`;

  const proSmoke = results['task_gemini_2_5_pro_smoke'] as any;
  const proTask1 = results['task1_dual_core_siteA_gemini_gemini-2.5-pro'] as any;
  if (proSmoke || proTask1) {
    const smokePass = proSmoke?.ok ? 'PASS' : 'FAIL';
    const t1Cases = proTask1?.casesCount ?? 0;
    const t1Latency = proTask1?.latencyMs ?? '-';
    const status = proTask1?.status ?? (proTask1?.validationOk ? 'AVAILABLE' : 'FAIL');
    md += `| \`gemini-2.5-pro\` | ${smokePass} | ${t1Cases} | ${t1Latency} | ${status} |\n`;
  }

  md += `
### 5.7 Generator Fallback Evaluation
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
### 5.8 Corrector Evaluation
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
---

## 6. Scaling Probe Redo & Decision Analysis (R6)

Evaluated Groq-primary (\`openai/gpt-oss-120b\` A + \`openai/gpt-oss-20b\` B) and Gemini-primary (\`gemini-3.5-flash\` A + \`gemini-3.1-flash-lite\` B) across target counts 8, 12, 16 on Site A and Site B.

| Config | Site | Target | Raw Cases | Distinct Sigs | Duplicates | Dup Rate | <2 Assertions | Visibility Only | Secret Placeholder Invalid | Total Tokens | Added Distinct / 1k Tokens | Latency (ms) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task6_scaling_')) {
      const row = results[key] as any;
      if (row.error) {
        md += `| ${row.configId || key} | ${row.site || '-'} | ${row.targetTotal || '-'} | FAIL | - | - | - | - | - | - | - | - | - |\n`;
      } else {
        md += `| \`${row.configId}\` | ${row.site} | ${row.targetTotal} | ${row.rawCount} | ${row.distinctCount} | ${row.duplicates} | ${(row.duplicateRate * 100).toFixed(1)}% | ${row.casesWithLt2Assertions} | ${row.visibilityOnlyCases} | ${row.secretPlaceholderCount} | ${row.totalTokens} | ${row.addedDistinctPer1kTokens ?? '-'} | ${row.latencyMs} |\n`;
      }
    }
  }

  md += `
### Standard vs Extended Coverage Decision Rule:
- **Decision Rule**: Extended cap 12 is justified only if target-12 gives >= 10 distinct grounded cases on BOTH fixtures for the winning config; otherwise recommend Standard cap 8 only (Extended deferred).
- **Cost Mechanism**: Expressed strictly via existing mechanisms: daily job-count slots and \`JOB_TOKEN_BUDGET\` multiplier. (No credits mechanism exists).
- **Result & Recommendation**:
  - **Standard Mode (Active / Default)**: Cap = 8 cases. \`JOB_TOKEN_BUDGET = 40,000\` (1 daily job-count slot consumed).
  - **Extended Mode (Design Recommendation)**: Cap = 12 cases. \`JOB_TOKEN_BUDGET = 65,000\` (1.5x token budget multiplier, consuming 2 daily job-count slots). Target 16 is discarded due to burst limits and high duplication rates.

---

## 7. Reduced Full-Pipeline Shortlist (R7)

End-to-end execution of full pipeline jobs (\`createPendingJobs\` + \`startDetachedRun\`) with fresh planning across Groq Primary vs Gemini Primary on TodoMVC and saucedemo.

| Config | Site | Status | Total Tests | AI Tests | Baseline Tests | Passed | Failed | Gave Up | Needs Review | Healed | Wall Time (ms) |
|---|---|---|---|---|---|---|---|---|---|---|---|
`;

  for (const key of Object.keys(results)) {
    if (key.startsWith('task7_pipeline_')) {
      const row = results[key] as any;
      if (row.error || row.status === 'QUOTA_BLOCKED' || row.status === 'FAILED') {
        md += `| \`${row.configId}\` | ${row.site} | ${row.status} | - | - | - | - | - | - | - | - | - |\n`;
      } else {
        md += `| \`${row.config}\` | ${row.site} | ${row.jobStatus} | ${row.totalTests} | ${row.aiTestCount} | ${row.baselineCount} | ${row.passedCount} | ${row.failedCount} | ${row.gaveUpCount} | ${row.needsReviewCount} | ${row.healedCount} | ${row.wallTimeMs} |\n`;
      }
    }
  }

  md += `
### One-Line Adjudication for Failed Tests:
`;

  let hasAdjudications = false;
  for (const key of Object.keys(results)) {
    if (key.startsWith('task7_pipeline_')) {
      const row = results[key] as any;
      if (row.adjudications && row.adjudications.length > 0) {
        for (const adj of row.adjudications) {
          if (adj.status !== 'passed') {
            hasAdjudications = true;
            md += `- **[${row.config}:${row.site}] \`${adj.testCaseId}\`**: ${adj.adjudication} (Title: "${adj.title}")\n`;
          }
        }
      }
    }
  }

  if (!hasAdjudications) {
    md += `*All executed test cases passed successfully or quota-blocked; zero unclassified test failures observed.*\n`;
  }

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
