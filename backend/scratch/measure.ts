import { runPipeline } from '../src/agent/pipeline.ts';
import { prisma } from '../src/db/client.ts';
import { getJobById, getJobDetailView, createPendingJobs } from '../src/db/jobs.ts';
import { buildJobDetail } from '../src/agent/jobDetail.ts';
import { startDetachedRun, type QueuedJob } from '../src/agent/jobRunner.ts';
import { stopEgressProxy } from '../src/security/egressProxy.ts';
import { setBudgetCountProviderForTest, resetReservationsForTest } from '../src/security/dailyBudget.ts';
import { config } from '../src/config.ts';
import { isTerminal } from '../src/api/jobStream.ts';
import { subscribeJobEvents, openJobChannel } from '../src/agent/jobEvents.ts';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

if (process.env.MEASURE !== '1') {
  console.log('skipped');
  process.exit(0);
}

// Enforce real pipeline settings per prompt requirements
process.env.LOCAL_AGENT_MODE = 'false';
process.env.BASELINE_TESTS = 'true';
process.env.A11Y_SMOKE = 'true';
(config as any).LOCAL_AGENT_MODE = false;
(config as any).BASELINE_TESTS = true;
(config as any).A11Y_SMOKE = true;

// Ensure daily budget check does not block the 12 measurement runs
setBudgetCountProviderForTest(async () => ({ global: 0, visitor: 0, ip: 0 }));
resetReservationsForTest();

interface RunConfig {
  name: string;
  url: string;
  fresh: boolean;
  deepCrawl?: boolean;
  tokenBudget?: number;
  testData?: Array<{ elementId: string; css: string; value: string; sensitive: boolean }>;
}

const MATRIX: RunConfig[] = [
  // 1. TodoMVC × 1 (fresh=true)
  {
    name: '1. TodoMVC (fresh=true #1)',
    url: 'https://demo.playwright.dev/todomvc',
    fresh: true,
  },
  // 2. TodoMVC right after run 1 with fresh=false (plan cache hit)
  {
    name: '2. TodoMVC (fresh=false, plan-cache hit)',
    url: 'https://demo.playwright.dev/todomvc',
    fresh: false,
  },
  // 3. TodoMVC × 1 (fresh=true #2)
  {
    name: '3. TodoMVC (fresh=true #2)',
    url: 'https://demo.playwright.dev/todomvc',
    fresh: true,
  },
  // 4. the-internet login #1 (with test data)
  {
    name: '4. the-internet login (with test data #1)',
    url: 'https://the-internet.herokuapp.com/login',
    fresh: true,
    testData: [
      { elementId: 'elem-2', css: '#username', value: 'tomsmith', sensitive: false },
      { elementId: 'elem-4', css: '#password', value: 'SuperSecretPassword!', sensitive: true },
    ],
  },
  // 5. the-internet login #2 (with test data)
  {
    name: '5. the-internet login (with test data #2)',
    url: 'https://the-internet.herokuapp.com/login',
    fresh: true,
    testData: [
      { elementId: 'elem-2', css: '#username', value: 'tomsmith', sensitive: false },
      { elementId: 'elem-4', css: '#password', value: 'SuperSecretPassword!', sensitive: true },
    ],
  },
  // 6. the-internet root deepCrawl=true
  {
    name: '6. the-internet root (deepCrawl=true)',
    url: 'https://the-internet.herokuapp.com/',
    fresh: true,
    deepCrawl: true,
  },
  // 7. saucedemo #1 (with test data)
  {
    name: '7. saucedemo (with test data #1)',
    url: 'https://www.saucedemo.com/',
    fresh: true,
    testData: [
      { elementId: 'elem-1', css: '#user-name', value: 'standard_user', sensitive: false },
      { elementId: 'elem-2', css: '#password', value: 'secret_sauce', sensitive: true },
    ],
  },
  // 8. saucedemo #2 (with test data)
  {
    name: '8. saucedemo (with test data #2)',
    url: 'https://www.saucedemo.com/',
    fresh: true,
    testData: [
      { elementId: 'elem-1', css: '#user-name', value: 'standard_user', sensitive: false },
      { elementId: 'elem-2', css: '#password', value: 'secret_sauce', sensitive: true },
    ],
  },
  // 9. practicetestautomation #1 (with test data)
  {
    name: '9. practicetestautomation (with test data #1)',
    url: 'https://practicetestautomation.com/practice-test-login/',
    fresh: true,
    testData: [
      { elementId: 'elem-9', css: '#username', value: 'student', sensitive: false },
      { elementId: 'elem-10', css: '#password', value: 'Password123', sensitive: true },
    ],
  },
  // 10. practicetestautomation #2 (with test data)
  {
    name: '10. practicetestautomation (with test data #2)',
    url: 'https://practicetestautomation.com/practice-test-login/',
    fresh: true,
    testData: [
      { elementId: 'elem-9', css: '#username', value: 'student', sensitive: false },
      { elementId: 'elem-10', css: '#password', value: 'Password123', sensitive: true },
    ],
  },
  // 11. practicetestautomation WITHOUT test data
  {
    name: '11. practicetestautomation (WITHOUT test data)',
    url: 'https://practicetestautomation.com/practice-test-login/',
    fresh: true,
  },
  // 12. saucedemo with JOB_TOKEN_BUDGET=8000
  {
    name: '12. saucedemo (JOB_TOKEN_BUDGET=8000)',
    url: 'https://www.saucedemo.com/',
    fresh: true,
    tokenBudget: 8000,
    testData: [
      { elementId: 'elem-1', css: '#user-name', value: 'standard_user', sensitive: false },
      { elementId: 'elem-2', css: '#password', value: 'secret_sauce', sensitive: true },
    ],
  },
];

export interface RunMeasurement {
  index: number;
  name: string;
  url: string;
  fresh: boolean;
  deepCrawl: boolean;
  tokenBudget: number;
  jobId: string;
  queuedMs: number;
  wallMs: number;
  finalStatus: string;
  errorCode: string | null;
  budgetNoteEmitted: boolean;
  crawl: {
    visibleElements: number;
    totalFound: number;
    formsCount: number;
    pagesCount: number;
    crawlMs: number;
  };
  plan: {
    aiCaseCount: number;
    baselineCaseCount: number;
    totalCases: number;
    expansionTriggered: boolean;
    expansionReason: string;
    planCacheHit: boolean;
    salvagedCount: number;
    cases: Array<{ id: string; title: string; category?: string; stepCount: number }>;
  };
  latencies: {
    crawlMs: number;
    planMs: number;
    generateMs: number;
    validateMs: number;
    executeMs: number;
    correctMs: number;
  };
  llm: {
    totalCalls: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    callsByStep: Record<string, number>;
    tokensByStep: Record<string, { prompt: number; completion: number; total: number }>;
    providersUsed: string[];
    modelsUsed: string[];
    compiledCount: number;
    llmGenerateCount: number;
    rateLimits429: number;
    fallbacks: number;
  };
  tests: {
    passed: number;
    failed: number;
    gaveUp: number;
    healed: number;
    correctionsAttempted: number;
    tokenCapGaveUp: number;
    failureClassDistribution: Record<string, number>;
    details: Array<{
      testCaseId: string;
      filename: string;
      finalStatus: string;
      totalAttempts: number;
      code: string;
      attempts: Array<{
        attemptNumber: number;
        validationPassed: boolean;
        executionPassed: boolean | null;
        failureClass: string | null;
        executionError: string | null;
        corrected: boolean;
      }>;
    }>;
  };
  payloadBytes: {
    fullBytes: number;
    slimBytes: number;
    reductionPct: number;
  };
}

async function runSingleMeasurement(spec: RunConfig, index: number): Promise<RunMeasurement> {
  console.log(`\n================================================================`);
  console.log(`[Run ${index + 1}/12] Starting ${spec.name}`);
  console.log(`URL: ${spec.url} | fresh: ${spec.fresh} | budget: ${spec.tokenBudget ?? 40000}`);
  console.log(`================================================================`);

  // Configure token budget for this run
  const activeBudget = spec.tokenBudget ?? 40000;
  (config as any).JOB_TOKEN_BUDGET = activeBudget;

  const jobId = crypto.randomUUID();
  const visitorId = `visitor-measure-${index}-${Date.now()}`;
  const ipHash = `ip-measure-${index}`;
  const runGroupId = crypto.randomUUID();

  openJobChannel(jobId);
  let budgetNoteEmitted = false;
  const sub = subscribeJobEvents(jobId, undefined, (event) => {
    if (event.type === 'budget_note') {
      budgetNoteEmitted = true;
      console.log(`  [Event] budget_note emitted: ${JSON.stringify(event.data)}`);
    }
  });

  // Track 429s and LLM provider fallbacks
  let rateLimits429 = 0;
  let fallbacks = 0;
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    if (text.includes('429') || text.includes('RATE_LIMITED') || text.includes('rate limit')) {
      rateLimits429++;
    }
    if (text.includes('fallback to') || text.includes('Falling back')) {
      fallbacks++;
    }
    originalWarn.apply(console, args);
  };

  try {
    await createPendingJobs([{ id: jobId, targetUrl: spec.url }], {
      visitorId,
      usedOwnKeys: false,
      ipHash,
      runGroupId,
    });

    const queuedJob: QueuedJob = {
      id: jobId,
      url: spec.url,
      fresh: spec.fresh,
      deepCrawl: spec.deepCrawl,
      testData: spec.testData,
    };

    const runStartWall = Date.now();
    await new Promise<void>((resolve) => {
      startDetachedRun([queuedJob], {}, {
        onSettled: () => resolve(),
      });
    });

    // Wait until job is terminal in DB
    while (true) {
      const row = await prisma.job.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (row && isTerminal(row.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const wallMs = Date.now() - runStartWall;

    const fullJob = await getJobById(jobId);
    const detailJob = await getJobDetailView(jobId);

    if (!fullJob || !detailJob) {
      throw new Error(`Job ${jobId} could not be retrieved from DB after settlement`);
    }

    const queuedMs = fullJob.startedAt && fullJob.createdAt
      ? Math.max(0, fullJob.startedAt.getTime() - fullJob.createdAt.getTime())
      : 0;

    // Crawl metrics
    const appMap = fullJob.appMap as any;
    const elements = appMap?.elements ?? [];
    const visibleElements = elements.filter((e: any) => e.isVisible !== false).length;
    const formsCount = appMap?.forms?.length ?? 0;
    const pagesCount = appMap?.pages?.length ?? 1;

    // Latency sums per step
    const latencies = {
      crawlMs: 0,
      planMs: 0,
      generateMs: 0,
      validateMs: 0,
      executeMs: 0,
      correctMs: 0,
    };
    const callsByStep: Record<string, number> = {};
    const tokensByStep: Record<string, { prompt: number; completion: number; total: number }> = {};
    const providersSet = new Set<string>();
    const modelsSet = new Set<string>();

    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalLlmCalls = 0;
    let compiledCount = 0;
    let llmGenerateCount = 0;

    for (const step of fullJob.agentSteps) {
      const type = step.stepType;
      if (type in latencies) {
        (latencies as any)[`${type}Ms`] += step.latencyMs ?? 0;
      }

      if (type === 'generate') {
        if (!step.llmProvider) compiledCount++;
        else llmGenerateCount++;
      }

      if (step.llmProvider) {
        totalLlmCalls++;
        providersSet.add(step.llmProvider);
        if (step.llmModel) modelsSet.add(step.llmModel);

        callsByStep[type] = (callsByStep[type] ?? 0) + 1;
        const pTokens = step.promptTokens ?? 0;
        const cTokens = step.completionTokens ?? 0;
        totalPrompt += pTokens;
        totalCompletion += cTokens;

        if (!tokensByStep[type]) {
          tokensByStep[type] = { prompt: 0, completion: 0, total: 0 };
        }
        tokensByStep[type].prompt += pTokens;
        tokensByStep[type].completion += cTokens;
        tokensByStep[type].total += (pTokens + cTokens);
      }
    }

    // Plan metrics
    const testPlan = fullJob.testPlan as any;
    const testCases: any[] = testPlan?.testCases ?? [];
    const aiCases = fullJob.generatedTests.filter((t) => !t.testCaseId.startsWith('smoke-'));
    const baselineCases = fullJob.generatedTests.filter((t) => t.testCaseId.startsWith('smoke-'));

    // Expansion & Cache analysis
    const planStep = fullJob.agentSteps.find((s) => s.stepType === 'plan');
    const planCacheHit = planStep ? (planStep.latencyMs ?? 0) < 50 && (planStep.promptTokens ?? 0) === 0 : false;
    const expansionTriggered = testCases.length > 5;
    let expansionReason = 'none';
    if (!expansionTriggered) {
      if (testCases.length >= 5) expansionReason = '<5 rule satisfied (already >= 5)';
      else if (visibleElements < 6) expansionReason = `visibleCount < 6 (${visibleElements})`;
      else expansionReason = 'meter / criteria not met';
    } else {
      expansionReason = 'triggered (<5 initial and >=6 elements)';
    }

    // Test execution and correction outcomes
    let passedCount = 0;
    let failedCount = 0;
    let gaveUpCount = 0;
    let healedCount = 0;
    let correctionsAttempted = 0;
    let tokenCapGaveUp = 0;
    const failureClassDist: Record<string, number> = {};

    const testDetails = fullJob.generatedTests.map((t) => {
      if (t.finalStatus === 'passed') passedCount++;
      else if (t.finalStatus === 'failed') failedCount++;
      else if (t.finalStatus === 'gave_up') {
        gaveUpCount++;
        const lastErr = t.executionResults[t.executionResults.length - 1]?.executionError ?? '';
        if (lastErr.includes('budget') || lastErr.includes('token') || budgetNoteEmitted) {
          tokenCapGaveUp++;
        }
      }

      if (t.finalStatus === 'passed' && t.totalAttempts > 1) {
        healedCount++;
      }

      for (const res of t.executionResults) {
        if (res.corrected) correctionsAttempted++;
        if (res.failureClass) {
          failureClassDist[res.failureClass] = (failureClassDist[res.failureClass] ?? 0) + 1;
        }
      }

      return {
        testCaseId: t.testCaseId,
        filename: t.filename,
        finalStatus: t.finalStatus,
        totalAttempts: t.totalAttempts,
        code: t.finalCode,
        attempts: t.executionResults.map((r) => ({
          attemptNumber: r.attemptNumber,
          validationPassed: r.validationPassed,
          executionPassed: r.executionPassed,
          failureClass: r.failureClass,
          executionError: r.executionError,
          corrected: r.corrected,
        })),
      };
    });

    // Payload size comparison
    const fullPayloadStr = JSON.stringify(buildJobDetail(fullJob));
    const slimPayloadStr = JSON.stringify(buildJobDetail(detailJob as any));
    const fullBytes = Buffer.byteLength(fullPayloadStr, 'utf8');
    const slimBytes = Buffer.byteLength(slimPayloadStr, 'utf8');
    const reductionPct = Math.round(((fullBytes - slimBytes) / fullBytes) * 100);

    const measurement: RunMeasurement = {
      index,
      name: spec.name,
      url: spec.url,
      fresh: spec.fresh,
      deepCrawl: spec.deepCrawl ?? false,
      tokenBudget: activeBudget,
      jobId,
      queuedMs,
      wallMs,
      finalStatus: fullJob.status,
      errorCode: fullJob.errorCode,
      budgetNoteEmitted,
      crawl: {
        visibleElements,
        totalFound: appMap?.totalElementsFound ?? elements.length,
        formsCount,
        pagesCount,
        crawlMs: latencies.crawlMs,
      },
      plan: {
        aiCaseCount: aiCases.length,
        baselineCaseCount: baselineCases.length,
        totalCases: fullJob.generatedTests.length,
        expansionTriggered,
        expansionReason,
        planCacheHit,
        salvagedCount: 0,
        cases: testCases.map((tc) => ({
          id: tc.id,
          title: tc.title,
          category: tc.category,
          stepCount: tc.steps?.length ?? 0,
        })),
      },
      latencies,
      llm: {
        totalCalls: totalLlmCalls,
        totalPromptTokens: totalPrompt,
        totalCompletionTokens: totalCompletion,
        totalTokens: totalPrompt + totalCompletion,
        callsByStep,
        tokensByStep,
        providersUsed: [...providersSet],
        modelsUsed: [...modelsSet],
        compiledCount,
        llmGenerateCount,
        rateLimits429,
        fallbacks,
      },
      tests: {
        passed: passedCount,
        failed: failedCount,
        gaveUp: gaveUpCount,
        healed: healedCount,
        correctionsAttempted,
        tokenCapGaveUp,
        failureClassDistribution: failureClassDist,
        details: testDetails,
      },
      payloadBytes: {
        fullBytes,
        slimBytes,
        reductionPct,
      },
    };

    console.log(`[Run ${index + 1}/12] Completed: ${measurement.finalStatus} in ${Math.round(wallMs / 1000)}s | Passed: ${passedCount}, Failed: ${failedCount}, GaveUp: ${gaveUpCount}, Healed: ${healedCount} | Tokens: ${measurement.llm.totalTokens}`);
    return measurement;
  } finally {
    console.warn = originalWarn;
    sub?.unsubscribe();
  }
}

async function main() {
  console.log('=== STARTING 12-RUN MEASUREMENT BENCHMARK ===');
  console.log(`Local Time: ${new Date().toISOString()}`);
  console.log(`Node: ${process.version} | Platform: ${process.platform} ${process.arch}`);

  const results: RunMeasurement[] = [];

  for (let i = 0; i < MATRIX.length; i++) {
    const spec = MATRIX[i];
    const measurement = await runSingleMeasurement(spec, i);
    results.push(measurement);

    // Persist running results to scratch after each run
    const outputPath = path.join(process.cwd(), 'scratch', 'measurement-results.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');

    if (i < MATRIX.length - 1) {
      console.log(`\nSleeping 70s between runs to reset Groq 8k TPM limits (next: ${MATRIX[i + 1].name})...`);
      for (let sec = 70; sec > 0; sec -= 10) {
        process.stdout.write(`${sec}s... `);
        await new Promise((r) => setTimeout(r, 10000));
      }
      console.log('Done waiting. Proceeding to next run.\n');
    }
  }

  await stopEgressProxy();
  await prisma.$disconnect();

  console.log('\n=== ALL 12 MEASUREMENT RUNS COMPLETED SUCCESSFULLY ===');
}

main().catch(async (err) => {
  console.error('\n❌ Measurement Benchmark Failed:', err);
  try {
    await stopEgressProxy();
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
