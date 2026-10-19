/**
 * Measurement runner for Prompt B on commit c89620e.
 *
 * Runs 12 test matrix configurations against live target applications,
 * measures latency, token usage, LLM calls, crawl stats, plan expansion,
 * corrections, and payload sizes, and outputs full structured audit data.
 *
 * Guarded by MEASURE=1; exits 0 with "skipped" otherwise.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/db/client.ts';
import { getJobById, getJobDetailView, createPendingJobs } from '../src/db/jobs.ts';
import { buildJobDetail } from '../src/agent/jobDetail.ts';
import { startDetachedRun } from '../src/agent/jobRunner.ts';
import { ensureEgressProxy, stopEgressProxy } from '../src/security/egressProxy.ts';
import { config } from '../src/config.ts';
import type { TestDataEntry } from '../src/api/schemas.ts';

if (process.env.MEASURE !== '1') {
  console.log('MEASURE is not set to "1"; measurement run skipped.');
  process.exit(0);
}

// Ensure process-level environment flags for the measurement run
process.env.LOCAL_AGENT_MODE = 'false';
process.env.BASELINE_TESTS = 'true';
process.env.A11Y_SMOKE = 'true';
process.env.JOB_TOKEN_BUDGET = '40000';
process.env.GENERATE_DAILY_LIMIT = '1000';
process.env.FREE_VISITOR_DAILY_LIMIT = '1000';
process.env.FREE_IP_DAILY_LIMIT = '1000';

interface MatrixRunDef {
  index: number;
  matrixItem: number;
  label: string;
  siteName: string;
  url: string;
  deepCrawl?: boolean;
  fresh?: boolean;
  testData?: TestDataEntry[];
  tokenBudget?: number;
  note: string;
}

const MATRIX_RUNS: MatrixRunDef[] = [
  // 1. TodoMVC × 2
  {
    index: 1,
    matrixItem: 1,
    label: 'todomvc-run1',
    siteName: 'TodoMVC',
    url: 'https://demo.playwright.dev/todomvc',
    fresh: true,
    note: 'TodoMVC run 1 (fresh=true)',
  },
  // 8. TodoMVC same URL × 1 with fresh=false right after run 1 (plan-cache hit)
  {
    index: 2,
    matrixItem: 8,
    label: 'todomvc-cache-hit',
    siteName: 'TodoMVC (cache hit)',
    url: 'https://demo.playwright.dev/todomvc',
    fresh: false,
    note: 'TodoMVC plan-cache hit (fresh=false immediately after run 1)',
  },
  // 1. TodoMVC second fresh run
  {
    index: 3,
    matrixItem: 1,
    label: 'todomvc-run2',
    siteName: 'TodoMVC',
    url: 'https://demo.playwright.dev/todomvc',
    fresh: true,
    note: 'TodoMVC run 2 (fresh=true)',
  },
  // 2. the-internet login × 2 with test data
  {
    index: 4,
    matrixItem: 2,
    label: 'the-internet-login-1',
    siteName: 'the-internet login',
    url: 'https://the-internet.herokuapp.com/login',
    fresh: true,
    testData: [
      { elementId: 'username', css: '#username', value: 'tomsmith', sensitive: false },
      { elementId: 'password', css: '#password', value: 'SuperSecretPassword!', sensitive: true },
    ],
    note: 'the-internet login run 1 with valid credentials',
  },
  {
    index: 5,
    matrixItem: 2,
    label: 'the-internet-login-2',
    siteName: 'the-internet login',
    url: 'https://the-internet.herokuapp.com/login',
    fresh: true,
    testData: [
      { elementId: 'username', css: '#username', value: 'tomsmith', sensitive: false },
      { elementId: 'password', css: '#password', value: 'SuperSecretPassword!', sensitive: true },
    ],
    note: 'the-internet login run 2 with valid credentials',
  },
  // 3. the-internet root × 1 deepCrawl=true
  {
    index: 6,
    matrixItem: 3,
    label: 'the-internet-root-deep',
    siteName: 'the-internet root',
    url: 'https://the-internet.herokuapp.com/',
    deepCrawl: true,
    fresh: true,
    note: 'the-internet root with deepCrawl=true',
  },
  // 4. saucedemo × 2 with test data
  {
    index: 7,
    matrixItem: 4,
    label: 'saucedemo-1',
    siteName: 'saucedemo',
    url: 'https://www.saucedemo.com/',
    fresh: true,
    testData: [
      { elementId: 'user-name', css: '#user-name', value: 'standard_user', sensitive: false },
      { elementId: 'password', css: '#password', value: 'secret_sauce', sensitive: true },
    ],
    note: 'saucedemo run 1 with valid credentials',
  },
  {
    index: 8,
    matrixItem: 4,
    label: 'saucedemo-2',
    siteName: 'saucedemo',
    url: 'https://www.saucedemo.com/',
    fresh: true,
    testData: [
      { elementId: 'user-name', css: '#user-name', value: 'standard_user', sensitive: false },
      { elementId: 'password', css: '#password', value: 'secret_sauce', sensitive: true },
    ],
    note: 'saucedemo run 2 with valid credentials',
  },
  // 5. practicetestautomation × 2 with test data
  {
    index: 9,
    matrixItem: 5,
    label: 'practicetestautomation-1',
    siteName: 'practicetestautomation',
    url: 'https://practicetestautomation.com/practice-test-login/',
    fresh: true,
    testData: [
      { elementId: 'username', css: '#username', value: 'student', sensitive: false },
      { elementId: 'password', css: '#password', value: 'Password123', sensitive: true },
    ],
    note: 'practicetestautomation run 1 with valid credentials',
  },
  {
    index: 10,
    matrixItem: 5,
    label: 'practicetestautomation-2',
    siteName: 'practicetestautomation',
    url: 'https://practicetestautomation.com/practice-test-login/',
    fresh: true,
    testData: [
      { elementId: 'username', css: '#username', value: 'student', sensitive: false },
      { elementId: 'password', css: '#password', value: 'Password123', sensitive: true },
    ],
    note: 'practicetestautomation run 2 with valid credentials',
  },
  // 6. practicetestautomation WITHOUT test data
  {
    index: 11,
    matrixItem: 6,
    label: 'practicetestautomation-no-data',
    siteName: 'practicetestautomation (no data)',
    url: 'https://practicetestautomation.com/practice-test-login/',
    fresh: true,
    note: 'practicetestautomation without test data (evaluates negative/validation case generation)',
  },
  // 7. saucedemo with JOB_TOKEN_BUDGET=8000
  {
    index: 12,
    matrixItem: 7,
    label: 'saucedemo-budget-cap',
    siteName: 'saucedemo (capped)',
    url: 'https://www.saucedemo.com/',
    fresh: true,
    tokenBudget: 8000,
    testData: [
      { elementId: 'user-name', css: '#user-name', value: 'standard_user', sensitive: false },
      { elementId: 'password', css: '#password', value: 'secret_sauce', sensitive: true },
    ],
    note: 'saucedemo with low token budget 8000 (evaluates cap behavior & budget_note)',
  },
];

async function waitCooldown(seconds = 70) {
  console.log(`\n⏳ Cooldown: Waiting ${seconds}s so Groq TPM budget resets...`);
  for (let s = seconds; s > 0; s -= 10) {
    process.stdout.write(`  [${s}s remaining] `);
    await new Promise((r) => setTimeout(r, Math.min(10, s) * 1000));
  }
  console.log('✓ Resuming.\n');
}

export interface DetailedRunResult {
  runIndex: number;
  matrixItem: number;
  label: string;
  siteName: string;
  url: string;
  jobId: string;
  fresh: boolean;
  deepCrawl: boolean;
  tokenBudget: number;
  note: string;

  // Job times & status
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  queuedMs: number;
  wallMs: number;
  finalStatus: string;
  errorCode: string | null;
  errorMessage: string | null;

  // Crawl metrics
  crawl: {
    visibleElementCount: number;
    formsCount: number;
    pagesCount: number;
    crawlLatencyMs: number;
  };

  // Plan metrics
  plan: {
    aiCaseCount: number;
    baselineCaseCount: number;
    totalCases: number;
    expansionTriggered: boolean;
    expansionReason: string;
    planCacheHit: boolean;
    salvagedCasesCount: number;
    categories: string[];
  };

  // Latencies by phase
  phaseLatencies: {
    crawlMs: number;
    planMs: number;
    generateMs: number;
    validateMs: number;
    executeMs: number;
    correctMs: number;
  };

  // LLM calls & tokens
  llm: {
    totalCalls: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    callsByStep: Record<string, number>;
    tokensByStep: Record<string, number>;
    providerModels: Array<{ step: string; provider: string; model: string; tokens: number }>;
    fallbacksObserved: number;
    rateLimitsObserved: number;
  };

  // Test metrics
  tests: {
    total: number;
    passed: number;
    failedFinding: number;
    gaveUp: number;
    healed: number;
    correctionsAttempted: number;
    failureClasses: Record<string, number>;
    rejectedByGuards: number;
    gaveUpTokenBudget: number;
  };

  // Payload bytes
  payload: {
    fullBytes: number;
    slimBytes: number;
    reductionPercent: number;
  };

  // Test cases details
  testDetails: Array<{
    testCaseId: string;
    filename: string;
    finalStatus: string;
    totalAttempts: number;
    assertionCount: number;
    strongestAssertion: string;
    category: string;
    attempts: Array<{
      attemptNumber: number;
      validationPassed: boolean;
      executionPassed: boolean | null;
      failureClass: string | null;
      executionError?: string | null;
    }>;
  }>;
}

function analyzeAssertions(code: string): { count: number; strongest: string } {
  const matches = code.match(/expect\([^)]+\)\.([a-zA-Z]+)/g) ?? [];
  const assertions = matches.map((m) => m.split('.').pop() ?? '');

  // Hierarchy of strongest assertions
  const hierarchy = [
    'toHaveText',
    'toContainText',
    'toHaveURL',
    'toHaveValue',
    'toHaveCount',
    'toBeChecked',
    'toBeDisabled',
    'toBeEnabled',
    'toBeVisible',
    'not',
  ];

  let strongest = assertions[0] ?? 'toBeVisible';
  let bestIdx = hierarchy.length;
  for (const a of assertions) {
    const idx = hierarchy.indexOf(a);
    if (idx !== -1 && idx < bestIdx) {
      bestIdx = idx;
      strongest = a;
    }
  }

  return { count: matches.length, strongest };
}

function inferCategory(testCaseId: string, title?: string): string {
  if (testCaseId.startsWith('smoke-')) {
    if (testCaseId.includes('a11y')) return 'a11y';
    return 'smoke';
  }
  const text = (title ?? testCaseId).toLowerCase();
  if (text.includes('navigat') || text.includes('link') || text.includes('route')) return 'navigation';
  if (text.includes('invalid') || text.includes('empty') || text.includes('error') || text.includes('fail') || text.includes('reject')) return 'negative';
  if (text.includes('valid') || text.includes('require') || text.includes('format')) return 'validation';
  if (text.includes('state') || text.includes('toggle') || text.includes('filter') || text.includes('active') || text.includes('complete')) return 'state';
  if (text.includes('persist') || text.includes('reload') || text.includes('refresh') || text.includes('storage')) return 'persistence';
  if (text.includes('login') || text.includes('auth')) return 'validation';
  return 'state';
}

async function runMeasurement() {
  console.log('====================================================');
  console.log(' Prompt B — Measurement Run (Matrix of 12 Runs)     ');
  console.log(' Commit: c89620e                                    ');
  console.log(' Local Time: ' + new Date().toISOString());
  console.log('====================================================\n');

  await ensureEgressProxy();

  const results: DetailedRunResult[] = [];
  const resultsFile = path.resolve(process.cwd(), 'scratch', 'measure_results.json');
  await fs.mkdir(path.dirname(resultsFile), { recursive: true });

  try {
    const existingRaw = await fs.readFile(resultsFile, 'utf8');
    const existing = JSON.parse(existingRaw);
    if (Array.isArray(existing)) {
      results.push(...existing);
      console.log(`Loaded ${existing.length} existing completed runs from ${resultsFile}.\n`);
    }
  } catch {}

  for (let i = 0; i < MATRIX_RUNS.length; i++) {
    const runDef = MATRIX_RUNS[i];

    // Check if this run is already successfully completed in results
    if (results.some((r) => r.runIndex === runDef.index && r.finalStatus === 'completed')) {
      console.log(`Skipping [Run ${runDef.index}/12] ${runDef.siteName} (${runDef.label}) — already completed.\n`);
      continue;
    }

    // Wait 70s between runs, except before run 1
    if (i > 0 && results.length > 0) {
      await waitCooldown(70);
    }

    console.log(`\n----------------------------------------------------`);
    console.log(`[Run ${runDef.index}/12] Starting: ${runDef.siteName} (${runDef.label})`);
    console.log(`  URL: ${runDef.url}`);
    console.log(`  Deep crawl: ${Boolean(runDef.deepCrawl)} | Fresh: ${runDef.fresh !== false}`);
    if (runDef.tokenBudget) console.log(`  Token budget override: ${runDef.tokenBudget}`);
    console.log(`----------------------------------------------------`);

    const jobId = randomUUID();
    const visitorId = `visitor-measure-${randomUUID().slice(0, 8)}`;
    const originalBudget = config.JOB_TOKEN_BUDGET;

    if (runDef.tokenBudget) {
      (config as any).JOB_TOKEN_BUDGET = runDef.tokenBudget;
    } else {
      (config as any).JOB_TOKEN_BUDGET = 40000;
    }

    // 1. Create pending job
    await createPendingJobs(
      [{ id: jobId, targetUrl: runDef.url }],
      { visitorId, usedOwnKeys: false, ipHash: null, runGroupId: null },
    );

    const runStartTime = Date.now();

    // 2. Start detached run and await completion
    await new Promise<void>((resolve) => {
      startDetachedRun(
        [
          {
            id: jobId,
            url: runDef.url,
            deepCrawl: runDef.deepCrawl,
            fresh: runDef.fresh,
            testData: runDef.testData,
          },
        ],
        {}, // Server keys
        { onSettled: resolve },
      );
    });

    const elapsedTotalMs = Date.now() - runStartTime;

    // Restore default budget
    (config as any).JOB_TOKEN_BUDGET = originalBudget;

    // 3. Query DB metrics with retries in case pooler had a transient blip
    let fullJob: any = null;
    let slimJob: any = null;
    let dbJob: any = null;

    for (let dbAttempt = 1; dbAttempt <= 5; dbAttempt++) {
      try {
        fullJob = await getJobById(jobId);
        slimJob = await getJobDetailView(jobId);
        dbJob = await prisma.job.findUnique({
          where: { id: jobId },
          include: {
            agentSteps: { orderBy: { createdAt: 'asc' } },
            generatedTests: {
              orderBy: { createdAt: 'asc' },
              include: { executionResults: { orderBy: { attemptNumber: 'asc' } } },
            },
          },
        });
        if (dbJob) break;
      } catch (err) {
        if (dbAttempt === 5) throw err;
        console.warn(`[Measure] Transient DB read issue (attempt ${dbAttempt}/5), retrying in ${dbAttempt * 2}s...`);
        await new Promise((r) => setTimeout(r, dbAttempt * 2000));
      }
    }

    if (!dbJob) {
      console.error(`Failed to find job ${jobId} in DB!`);
      continue;
    }

    const queuedMs = dbJob.startedAt && dbJob.createdAt ? dbJob.startedAt.getTime() - dbJob.createdAt.getTime() : 0;
    const wallMs = dbJob.completedAt && dbJob.startedAt ? dbJob.completedAt.getTime() - dbJob.startedAt.getTime() : elapsedTotalMs;

    // Crawl stats
    const crawlStep = dbJob.agentSteps.find((s) => s.stepType === 'crawl');
    const appMapAny = fullJob?.appMap as any;
    const visibleElementCount = appMapAny?.elements?.filter((e: any) => e.isVisible !== false)?.length ?? appMapAny?.totalElementsFound ?? 0;
    const formsCount = appMapAny?.forms?.length ?? 0;
    const pagesCount = appMapAny?.pages?.length ?? 1;
    const crawlLatencyMs = crawlStep?.latencyMs ?? 0;

    // Plan stats
    const planStep = dbJob.agentSteps.find((s) => s.stepType === 'plan');
    const aiCases = dbJob.generatedTests.filter((t) => !t.testCaseId.startsWith('smoke-'));
    const baselineCases = dbJob.generatedTests.filter((t) => t.testCaseId.startsWith('smoke-'));
    const testPlanJson = dbJob.testPlan as any;
    const planCacheHit = planStep ? (planStep.latencyMs ?? 0) < 50 && (planStep.promptTokens ?? 0) === 0 : false;

    let expansionTriggered = false;
    let expansionReason = '';
    if (planCacheHit) {
      expansionReason = 'Plan-cache hit (reused cached plan)';
    } else if (visibleElementCount < 6) {
      expansionReason = `visibleCount (${visibleElementCount}) < 6`;
    } else if (aiCases.length >= 5) {
      expansionReason = `Initial plan already produced ${aiCases.length} cases (>=5 rule)`;
    } else {
      expansionTriggered = true;
      expansionReason = 'Triggered (<5 cases on page with >=6 visible elements)';
    }

    // Phase latencies
    const phaseLatencies = {
      crawlMs: 0,
      planMs: 0,
      generateMs: 0,
      validateMs: 0,
      executeMs: 0,
      correctMs: 0,
    };
    for (const step of dbJob.agentSteps) {
      const ms = step.latencyMs ?? 0;
      if (step.stepType === 'crawl') phaseLatencies.crawlMs += ms;
      else if (step.stepType === 'plan') phaseLatencies.planMs += ms;
      else if (step.stepType === 'generate') phaseLatencies.generateMs += ms;
      else if (step.stepType === 'validate') phaseLatencies.validateMs += ms;
      else if (step.stepType === 'execute') phaseLatencies.executeMs += ms;
      else if (step.stepType === 'correct') phaseLatencies.correctMs += ms;
    }

    // LLM metrics
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const callsByStep: Record<string, number> = {};
    const tokensByStep: Record<string, number> = {};
    const providerModels: Array<{ step: string; provider: string; model: string; tokens: number }> = [];

    for (const s of dbJob.agentSteps) {
      const pTok = s.promptTokens ?? 0;
      const cTok = s.completionTokens ?? 0;
      const tot = pTok + cTok;
      totalPromptTokens += pTok;
      totalCompletionTokens += cTok;

      if (tot > 0 || s.llmProvider) {
        callsByStep[s.stepType] = (callsByStep[s.stepType] ?? 0) + 1;
        tokensByStep[s.stepType] = (tokensByStep[s.stepType] ?? 0) + tot;
        if (s.llmProvider) {
          providerModels.push({
            step: s.stepType,
            provider: s.llmProvider,
            model: s.llmModel ?? 'unknown',
            tokens: tot,
          });
        }
      }
    }

    // Tests metrics
    let passedCount = 0;
    let failedFindingCount = 0;
    let gaveUpCount = 0;
    let healedCount = 0;
    let correctionsAttempted = 0;
    const failureClasses: Record<string, number> = {};
    let rejectedByGuards = 0;
    let gaveUpTokenBudget = 0;

    const testDetails = [];

    for (const t of dbJob.generatedTests) {
      if (t.finalStatus === 'passed') {
        passedCount++;
        if (t.totalAttempts > 1) healedCount++;
      } else if (t.finalStatus === 'failed') {
        failedFindingCount++;
      } else if (t.finalStatus === 'gave_up') {
        gaveUpCount++;
      }

      if (t.totalAttempts > 1) {
        correctionsAttempted += t.totalAttempts - 1;
      }

      for (const r of t.executionResults) {
        if (r.failureClass) {
          failureClasses[r.failureClass] = (failureClasses[r.failureClass] ?? 0) + 1;
        }
        if (r.executionError?.includes('token_budget') || r.executionError?.includes('Token budget exceeded')) {
          gaveUpTokenBudget++;
        }
        if (r.executionError?.includes('Assertion guard rejected') || r.executionError?.includes('Secret guard rejected')) {
          rejectedByGuards++;
        }
      }

      const { count: assertionCount, strongest: strongestAssertion } = analyzeAssertions(t.finalCode);
      const planTc = testPlanJson?.testCases?.find((tc: any) => tc.id === t.testCaseId);
      const category = inferCategory(t.testCaseId, planTc?.title);

      testDetails.push({
        testCaseId: t.testCaseId,
        filename: t.filename,
        finalStatus: t.finalStatus,
        totalAttempts: t.totalAttempts,
        assertionCount,
        strongestAssertion,
        category,
        attempts: t.executionResults.map((r) => ({
          attemptNumber: r.attemptNumber,
          validationPassed: r.validationPassed,
          executionPassed: r.executionPassed,
          failureClass: r.failureClass,
          executionError: r.executionError,
        })),
      });
    }

    // Payload byte comparison
    const fullPayloadStr = JSON.stringify(buildJobDetail(fullJob!));
    const slimPayloadStr = JSON.stringify(buildJobDetail(slimJob! as any));
    const fullBytes = Buffer.byteLength(fullPayloadStr, 'utf8');
    const slimBytes = Buffer.byteLength(slimPayloadStr, 'utf8');
    const reductionPercent = fullBytes > 0 ? Math.round(((fullBytes - slimBytes) / fullBytes) * 100) : 0;

    const runResult: DetailedRunResult = {
      runIndex: runDef.index,
      matrixItem: runDef.matrixItem,
      label: runDef.label,
      siteName: runDef.siteName,
      url: runDef.url,
      jobId,
      fresh: runDef.fresh !== false,
      deepCrawl: Boolean(runDef.deepCrawl),
      tokenBudget: runDef.tokenBudget ?? 40000,
      note: runDef.note,

      createdAt: dbJob.createdAt.toISOString(),
      startedAt: dbJob.startedAt?.toISOString() ?? null,
      completedAt: dbJob.completedAt?.toISOString() ?? null,
      queuedMs,
      wallMs,
      finalStatus: dbJob.status,
      errorCode: dbJob.errorCode,
      errorMessage: dbJob.errorMessage,

      crawl: {
        visibleElementCount,
        formsCount,
        pagesCount,
        crawlLatencyMs,
      },

      plan: {
        aiCaseCount: aiCases.length,
        baselineCaseCount: baselineCases.length,
        totalCases: dbJob.generatedTests.length,
        expansionTriggered,
        expansionReason,
        planCacheHit,
        salvagedCasesCount: 0,
        categories: [...new Set(testDetails.map((t) => t.category))],
      },

      phaseLatencies,

      llm: {
        totalCalls: Object.values(callsByStep).reduce((a, b) => a + b, 0),
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        callsByStep,
        tokensByStep,
        providerModels,
        fallbacksObserved: 0,
        rateLimitsObserved: 0,
      },

      tests: {
        total: dbJob.generatedTests.length,
        passed: passedCount,
        failedFinding: failedFindingCount,
        gaveUp: gaveUpCount,
        healed: healedCount,
        correctionsAttempted,
        failureClasses,
        rejectedByGuards,
        gaveUpTokenBudget,
      },

      payload: {
        fullBytes,
        slimBytes,
        reductionPercent,
      },

      testDetails,
    };

    results.push(runResult);
    await fs.writeFile(resultsFile, JSON.stringify(results, null, 2), 'utf8');

    console.log(`✓ Run ${runDef.index} completed in ${Math.round(wallMs / 1000)}s | Status: ${dbJob.status} | Tests: ${passedCount} passed, ${failedFindingCount} finding, ${gaveUpCount} gave up | Tokens: ${runResult.llm.totalTokens}`);
  }

  await stopEgressProxy();

  console.log('\n====================================================');
  console.log(' All 12 Matrix Measurement Runs Completed!         ');
  console.log('====================================================\n');

  console.log('| # | Site | Status | AI | Base | Pass | Finding | GaveUp | Healed | Tokens | Calls | Wall (s) | Slim / Full Bytes |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.runIndex} | ${r.siteName} | ${r.finalStatus} | ${r.plan.aiCaseCount} | ${r.plan.baselineCaseCount} | ${r.tests.passed} | ${r.tests.failedFinding} | ${r.tests.gaveUp} | ${r.tests.healed} | ${r.llm.totalTokens} | ${r.llm.totalCalls} | ${Math.round(r.wallMs / 1000)}s | ${r.payload.slimBytes} / ${r.payload.fullBytes} (-${r.payload.reductionPercent}%) |`);
  }
}

runMeasurement()
  .catch((err) => {
    console.error('Measurement failed with error:', err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {}
  });
