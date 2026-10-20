import path from 'node:path';
import { rm } from 'node:fs/promises';
import { crawlPage } from '../crawler/pageCrawler.ts';
import { assertPublicTarget } from '../security/netPolicy.ts';
import { config } from '../config.ts';
import { takeFreshCrawl } from '../crawler/crawlCache.ts';
import { planTests } from './steps/planner.ts';
import { generateTest } from './steps/generator.ts';
import type { GeneratedTest } from './steps/generator.ts';
import { compileTest, CompileError } from './steps/compiler.ts';
import { correctTest, correctionPreservesAssertions, correctionPreservesSecrets } from './steps/corrector.ts';
import { resolveTestData } from './testData.ts';
import { buildBaselineTests } from './baseline.ts';
import type { ElementRef, TestDataEntry } from '../api/schemas.ts';
import { validateTestCode } from '../runner/validator.ts';
import { executeTests, type TestCaseResult } from '../runner/executor.ts';
import { findUnsafeConstructs } from '../runner/codeSafety.ts';
import { RUNNER_TESTS_DIR } from '../runner/config.ts';
import type { AppMap, InteractiveElement } from '../crawler/types.ts';
import type { TestPlan } from './prompts/plannerPrompt.ts';
import type { ScopedElement } from './types.ts';
import { scoreTestConfidence } from './confidence.ts';
import type { ConfidenceScore } from './confidence.ts';
import type { JobStatus } from '@prisma/client';
import { markJobStarted, updateJobStatus, setAppMap, setTestPlan, completeJob, failJob } from '../db/jobs.ts';
import { publishJobEvent } from './jobEvents.ts';
import { recordGeneratedTest } from '../db/generatedTests.ts';
import { safeWrite, withPersistence } from '../db/safeWrite.ts';
import { withLlmStep, withMeasuredStep, recordStep } from './persistence.ts';
import { CrawlError } from '../crawler/crawlErrors.ts';
import { LlmError } from '../llm/types.ts';
import { RunnerError } from '../runner/errors.ts';
import { JobCancelledError } from './cancellation.ts';
import { prisma } from '../db/client.ts';

import { runRounds, type RoundTest, type TestAttempt } from './rounds.ts';

export type { GeneratedTest, TestAttempt };

export interface GeneratedTestResult {
  testCaseId: string;
  filename: string;
  code: string; // final code (last attempt)
  status: 'passed' | 'failed' | 'gave_up' | 'needs_review';
  attempts: TestAttempt[];
  confidence: ConfidenceScore;
}

export interface PipelineResult {
  jobId: string;
  appMap: AppMap;
  testPlan: TestPlan;
  generatedTests: GeneratedTestResult[];
}

function projectElementScope(elements: InteractiveElement[]): ScopedElement[] {
  return elements.map(({ id, type, text, selectors }) => ({
    id,
    type,
    text: text ?? null,
    selectors,
  }));
}

function announcePhase(jobId: string, status: JobStatus): void {
  publishJobEvent(jobId, { type: 'phase_change', data: { status } });
}

export function toJobErrorCode(error: unknown): string {
  if (error instanceof CrawlError || error instanceof LlmError || error instanceof RunnerError) {
    return error.code;
  }
  return 'INTERNAL_ERROR';
}

export function toJobErrorMessage(error: unknown): string {
  if (error instanceof CrawlError) {
    let msg = error.message.replace(/^[A-Z0-9_]+:\s*/, '');
    const details = error.details as Record<string, unknown> | undefined;
    const host = (details?.host as string) || '';
    if (details?.reason === 'dns_not_found') {
      return host ? `Website not found: could not resolve ${host}. Check the URL spelling.` : 'Website not found. Check the URL spelling.';
    }
    if (details?.reason === 'dns_temporary') {
      return host ? `Couldn't look up ${host}. The address lookup failed temporarily.` : 'The address lookup failed temporarily.';
    }
    if (details?.reason === 'connection_refused') {
      return host ? `Connection refused at ${host}. Make sure the server is running.` : 'Connection refused. Make sure the server is running.';
    }
    if (msg.includes('getaddrinfo') || msg.includes('ENOTFOUND')) {
      const extractedHost = msg.match(/ENOTFOUND\s+([^\s]+)/)?.[1] || host;
      return extractedHost ? `Website not found: could not resolve ${extractedHost}. Check the URL spelling.` : 'Website not found. Check the URL spelling.';
    }
    return msg;
  }
  if (error instanceof Error) {
    let msg = error.message.replace(/^[A-Z0-9_]+:\s*/, '');
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      const extractedHost = msg.match(/(?:ENOTFOUND|EAI_AGAIN)\s+([^\s]+)/)?.[1] || '';
      return extractedHost
        ? `Website not found: could not resolve ${extractedHost}. Check the URL spelling.`
        : 'Website not found. Check the URL spelling.';
    }
    if (msg.includes('ECONNREFUSED')) {
      const extractedHost = msg.match(/ECONNREFUSED\s+([^\s]+)/)?.[1] || '';
      return extractedHost
        ? `Connection refused at ${extractedHost}. Make sure the server is running.`
        : 'Connection refused. Make sure the server is running.';
    }
    return msg;
  }
  return String(error);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function crawlForJob(
  jobId: string,
  url: string,
  signal?: AbortSignal,
  fresh?: boolean,
): Promise<AppMap> {
  let attempt = 0;
  while (true) {
    try {
      const maxAgeMs = fresh ? 60_000 : 10 * 60_000;
      const cached = takeFreshCrawl(url, maxAgeMs);
      if (cached) {
        console.log(`[Pipeline] Crawl cache hit for ${url}`);
        return cached;
      }
      return await crawlPage(url, { signal });
    } catch (err) {
      if (err instanceof CrawlError && err.code === 'TARGET_WAKING' && attempt < 3) {
        attempt++;
        publishJobEvent(jobId, {
          type: 'target_waking',
          data: { attempt, nextRetryInSec: 30 },
        });
        await sleep(30_000, signal);
        continue;
      }
      throw err;
    }
  }
}

// The job row must already exist (createPendingJobs at admission).
export function runPipeline(
  job: {
    id: string;
    url: string;
    fresh?: boolean;
    testData?: TestDataEntry[];
    focus?: ElementRef[];
  },
  signal?: AbortSignal,
): Promise<PipelineResult> {
  return withPersistence(() =>
    runPersistedPipeline(job.id, job.url, job.testData, job.focus, signal, job.fresh),
  );
}

async function runPersistedPipeline(
  jobId: string,
  url: string,
  testData?: TestDataEntry[],
  focus?: ElementRef[],
  signal?: AbortSignal,
  fresh?: boolean,
): Promise<PipelineResult> {
  const runId = `run-${jobId}`;
  const runDir = path.join(RUNNER_TESTS_DIR, runId);
  let finishedPublished = false;

  try {
    signal?.throwIfAborted();
    await assertPublicTarget(url);
    await safeWrite('markJobStarted', () => markJobStarted(jobId));
    announcePhase(jobId, 'crawling');
    const appMap = await withMeasuredStep({ jobId }, 'crawl', () => crawlForJob(jobId, url, signal, fresh), () => ({ success: true }));
    await safeWrite('setAppMap', () => setAppMap(jobId, appMap));

    signal?.throwIfAborted();
    const resolvedData = testData && testData.length > 0 ? resolveTestData(appMap, testData) : undefined;

    let consumedTokens = 0;
    const tokenBudget = config.JOB_TOKEN_BUDGET;
    let budgetNoteEmitted = false;

    const trackTokens = (promptTokens?: number, completionTokens?: number) => {
      consumedTokens += (promptTokens ?? 0) + (completionTokens ?? 0);
      if (tokenBudget > 0 && consumedTokens >= tokenBudget && !budgetNoteEmitted) {
        budgetNoteEmitted = true;
        publishJobEvent(jobId, {
          type: 'budget_note',
          data: { message: 'Token budget reached: remaining failures were not auto-corrected.' },
        });
      }
    };

    announcePhase(jobId, 'planning');
    const testPlan = await withLlmStep(
      { jobId },
      'plan',
      () =>
        planTests(appMap, {
          testData,
          focus,
          signal,
          fresh,
          tokenBudget,
          consumedTokens: () => consumedTokens,
        }),
      trackTokens,
    );
    const baselineTests = buildBaselineTests(appMap);
    for (const b of baselineTests) {
      testPlan.testCases.push(b.testCase);
    }
    await safeWrite('setTestPlan', () => setTestPlan(jobId, testPlan));
    announcePhase(jobId, 'generating');

    type Origin = 'compiled' | 'llm' | 'corrected' | 'baseline';
    const tests: RoundTest[] = [];

    // Round 0: compileTest for every LLM case (CompileError → generateTest LLM fallback, origin 'llm');
    // add baseline tests from WP7 if present (origin 'baseline').
    for (const testCase of testPlan.testCases) {
      signal?.throwIfAborted();
      const referencedIds = new Set(
        testCase.steps
          .map((step) => step.elementId)
          .filter((id): id is string => id !== null),
      );

      const elementsInScope = projectElementScope(
        appMap.elements.filter((elem) => referencedIds.has(elem.id)),
      );

      const testCaseOrigin = (testCase as { origin?: string }).origin;
      if (testCaseOrigin === 'baseline' || testCase.id.startsWith('smoke-')) {
        const baselineMatch = baselineTests.find((b) => b.testCase.id === testCase.id);
        const filename = baselineMatch?.filename ?? `${testCase.id}.spec.ts`;
        const code = baselineMatch?.code ?? '';
        tests.push({
          testCase,
          filename,
          code,
          codeVersion: 1,
          validatedVersion: 0,
          origin: 'baseline',
          elementsInScope,
          attempts: [],
          priorErrors: [],
          status: 'open',
          recorded: false,
          announced: false,
        });
        continue;
      }

      await safeWrite('updateJobStatus:generating', () => updateJobStatus(jobId, 'generating'));
      announcePhase(jobId, 'generating');
      let initialGen: GeneratedTest;
      let origin: Origin = 'compiled';
      try {
        initialGen = await withMeasuredStep(
          { jobId, testCaseId: testCase.id },
          'generate',
          async () => compileTest(testCase, elementsInScope, appMap.url),
          () => ({ success: true }),
        );
      } catch (err) {
        if (err instanceof CompileError) {
          console.warn(`[Runner] ${testCase.id} | compileTest fallback to LLM: ${err.message}`);
          initialGen = await withLlmStep(
            { jobId, testCaseId: testCase.id },
            'generate',
            () => generateTest(testCase, elementsInScope, appMap.url, { signal }),
            trackTokens,
          );
          origin = 'llm';
        } else {
          throw err;
        }
      }

      tests.push({
        testCase,
        filename: initialGen.filename,
        code: initialGen.code,
        codeVersion: 1,
        validatedVersion: 0,
        origin,
        elementsInScope,
        attempts: [],
        priorErrors: [],
        status: 'open',
        recorded: false,
        announced: false,
      });
    }

    await runRounds(tests, {
      signal,
      appMap,
      startUrl: url,
      checkSafety: (code, filename) => findUnsafeConstructs(code, filename),
      validateBatch: async (filesToValidate) => {
        const startTsc = Date.now();
        const validationResult = await validateTestCode(runId, filesToValidate, { signal });
        const batchLatencyMs = Date.now() - startTsc;
        return {
          perFile: validationResult.perFile,
          batchLatencyMs,
        };
      },
      executeBatch: async (validFiles) => {
        const timeoutMs = Math.min(30_000 + validFiles.length * 25_000, 300_000);
        try {
          return await executeTests(runId, validFiles, {
            secrets: resolvedData?.secrets,
            timeoutMs,
            signal,
          });
        } catch (err) {
          if (err instanceof JobCancelledError || (err instanceof Error && err.name === 'AbortError') || signal?.aborted) {
            throw new JobCancelledError();
          }
          if (err instanceof RunnerError) {
            console.warn(
              `[Runner] Batch execution failed with ${err.code}: ${err.message}. Re-running per test.`,
            );
            const fallbackResults: TestCaseResult[] = [];
            for (const file of validFiles) {
              signal?.throwIfAborted();
              try {
                const singleRes = await executeTests(
                  runId,
                  [file],
                  {
                    secrets: resolvedData?.secrets,
                    timeoutMs: Math.min(30_000 + 25_000, 300_000),
                    signal,
                  },
                );
                fallbackResults.push(...singleRes.results);
              } catch (singleErr) {
                if (singleErr instanceof JobCancelledError || (singleErr instanceof Error && singleErr.name === 'AbortError') || signal?.aborted) {
                  throw new JobCancelledError();
                }
                const testCaseId = file.filename.replace(/\.spec\.ts$/, '');
                fallbackResults.push({
                  testCaseId,
                  passed: false,
                  durationMs: 0,
                  error: singleErr instanceof Error ? singleErr.message : String(singleErr),
                  failureClass: 'other',
                });
              }
            }
            return {
              success: fallbackResults.length > 0 && fallbackResults.every((r) => r.passed),
              results: fallbackResults,
            };
          }
          throw err;
        }
      },
      correct: async ({ test, errorText, attemptNumber }) => {
        const context = { jobId, testCaseId: test.testCase.id, attemptNumber };
        const correction = await withLlmStep(
          context,
          'correct',
          () =>
            correctTest(test.code, errorText, test.elementsInScope, test.priorErrors, { signal }),
          trackTokens,
        );
        if (
          correction.code &&
          correctionPreservesAssertions(test.code, correction.code) &&
          correctionPreservesSecrets(test.code, correction.code)
        ) {
          return { code: correction.code };
        }
        return null;
      },
      recordStep: async (step) => {
        await recordStep({
          jobId,
          testCaseId: step.testCaseId,
          attemptNumber: step.attemptNumber,
          stepType: step.stepType,
          status: step.status,
          latencyMs: step.latencyMs,
          errorDetail: step.errorDetail,
        });
      },
      onPhaseChange: async (phase) => {
        await safeWrite('updateJobStatus:executing', () => updateJobStatus(jobId, phase));
        announcePhase(jobId, phase);
      },
      emitTerminal: async (test) => {
        const finalStatus = test.status === 'open' ? 'gave_up' : test.status;
        const res = await safeWrite('recordGeneratedTest', () =>
          recordGeneratedTest({
            jobId,
            testCaseId: test.testCase.id,
            filename: test.filename,
            finalCode: test.code,
            finalStatus,
            attempts: test.attempts,
          }),
        );
        if (res !== undefined) {
          test.recorded = true;
        }
        if (!test.announced) {
          test.announced = true;
          publishJobEvent(jobId, {
            type: 'test_completed',
            data: {
              testCaseId: test.testCase.id,
              status: finalStatus,
              totalAttempts: test.attempts.length,
            },
          });
        }
      },
      canCorrect: () => {
        if (tokenBudget <= 0) return true;
        return consumedTokens < tokenBudget;
      },
    });

    // Retry unrecorded tests once
    for (const test of tests) {
      if (!test.recorded) {
        const finalStatus = test.status === 'open' ? 'gave_up' : test.status;
        const res = await safeWrite('recordGeneratedTest:retry', () =>
          recordGeneratedTest({
            jobId,
            testCaseId: test.testCase.id,
            filename: test.filename,
            finalCode: test.code,
            finalStatus,
            attempts: test.attempts,
          }),
        );
        if (res !== undefined) {
          test.recorded = true;
        }
      }
    }

    const generatedTests: GeneratedTestResult[] = tests.map((t) => ({
      testCaseId: t.testCase.id,
      filename: t.filename,
      code: t.code,
      status: t.status === 'open' ? 'gave_up' : t.status,
      attempts: t.attempts,
      confidence: scoreTestConfidence({
        code: t.code,
        finalStatus: t.status === 'open' ? 'gave_up' : t.status,
        attempts: t.attempts,
      }),
    }));

    const completeRes = await safeWrite('completeJob', () => completeJob(jobId), { critical: true });
    if (completeRes && completeRes.count === 0) {
      const current = await prisma.job.findUnique({
        where: { id: jobId },
        select: { status: true, errorCode: true },
      });
      const rowStatus = (current?.status as 'cancelled' | 'failed' | 'completed') ?? 'cancelled';
      if (!finishedPublished) {
        finishedPublished = true;
        publishJobEvent(jobId, {
          type: 'job_finished',
          data: { status: rowStatus, errorCode: current?.errorCode ?? null },
        });
      }
      return { jobId, appMap, testPlan, generatedTests };
    } else {
      if (!finishedPublished) {
        finishedPublished = true;
        publishJobEvent(jobId, { type: 'job_finished', data: { status: 'completed', errorCode: null } });
      }
    }
    return { jobId, appMap, testPlan, generatedTests };
  } catch (error) {
    if (
      error instanceof JobCancelledError ||
      (error instanceof Error && (error.name === 'AbortError' || error.message.includes('Job was cancelled'))) ||
      signal?.aborted
    ) {
      const now = new Date();
      await safeWrite(
        'cancelJob',
        () =>
          prisma.job.updateMany({
            where: { id: jobId, status: { notIn: ['completed', 'failed', 'cancelled'] } },
            data: { status: 'cancelled', cancelledAt: now },
          }),
        { critical: true },
      );
      announcePhase(jobId, 'cancelled');
      if (!finishedPublished) {
        finishedPublished = true;
        publishJobEvent(jobId, { type: 'job_finished', data: { status: 'cancelled', errorCode: null } });
      }
      throw new JobCancelledError();
    }
    const code = toJobErrorCode(error);
    const message = toJobErrorMessage(error);
    const failRes = await safeWrite('failJob', () => failJob(jobId, code, message), { critical: true });
    if (failRes && failRes.count === 0) {
      const current = await prisma.job.findUnique({
        where: { id: jobId },
        select: { status: true, errorCode: true },
      });
      const rowStatus = (current?.status as 'cancelled' | 'failed' | 'completed') ?? 'failed';
      if (!finishedPublished) {
        finishedPublished = true;
        publishJobEvent(jobId, {
          type: 'job_finished',
          data: { status: rowStatus, errorCode: current?.errorCode ?? code },
        });
      }
    } else {
      if (!finishedPublished) {
        finishedPublished = true;
        publishJobEvent(jobId, { type: 'job_finished', data: { status: 'failed', errorCode: code } });
      }
    }
    throw error;
  } finally {
    try {
      await rm(runDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
// Module component implementation.
