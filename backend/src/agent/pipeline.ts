import path from 'node:path';
import { rm } from 'node:fs/promises';
import { crawlPage, crawlSite } from '../crawler/pageCrawler.ts';
import { takeFreshCrawl } from '../crawler/crawlCache.ts';
import {
  DEEP_CRAWL_MAX_PAGES,
  DEEP_CRAWL_START_PAGE_ELEMENT_CAP,
  DEEP_CRAWL_EXTRA_PAGE_ELEMENT_CAP,
} from './run.config.ts';
import { planTests } from './steps/planner.ts';
import { generateTest } from './steps/generator.ts';
import type { GeneratedTest } from './steps/generator.ts';
import { compileTest, CompileError } from './steps/compiler.ts';
import { correctTest, correctionPreservesAssertions, correctionPreservesSecrets } from './steps/corrector.ts';
import { resolveTestData } from './testData.ts';
import type { ElementRef, TestDataEntry } from '../api/schemas.ts';
import { validateTestCode } from '../runner/validator.ts';
import { executeTests, type FailureClass, type TestCaseResult } from '../runner/executor.ts';
import { findUnsafeConstructs } from '../runner/codeSafety.ts';
import { RUNNER_TESTS_DIR } from '../runner/config.ts';
import type { AppMap, InteractiveElement } from '../crawler/types.ts';
import type { TestPlan, TestCase } from './prompts/plannerPrompt.ts';
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

export type { GeneratedTest };

export interface TestAttempt {
  attemptNumber: number; // 1 = original, 2 = first correction, 3 = second correction
  code: string;
  validationPassed: boolean;
  validationErrors?: string[];
  executionPassed?: boolean; // undefined if validation failed (never executed)
  executionError?: string; // trimmed error from executor
  failureClass?: FailureClass;
  durationMs?: number;
  corrected: boolean; // true if this attempt was produced by the corrector
}

export interface GeneratedTestResult {
  testCaseId: string;
  filename: string;
  code: string; // final code (last attempt)
  status: 'passed' | 'failed' | 'gave_up';
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

async function crawlForJob(url: string, deepCrawl: boolean): Promise<AppMap> {
  if (deepCrawl) {
    return crawlSite(url, {
      maxPages: DEEP_CRAWL_MAX_PAGES,
      startPageElementCap: DEEP_CRAWL_START_PAGE_ELEMENT_CAP,
      extraPageElementCap: DEEP_CRAWL_EXTRA_PAGE_ELEMENT_CAP,
    });
  }
  const cached = takeFreshCrawl(url);
  if (cached) {
    console.log(`[Pipeline] Crawl cache hit for ${url}`);
    return Promise.resolve(cached);
  }
  return crawlPage(url);
}

// The job row must already exist (createPendingJobs at admission).
export function runPipeline(job: {
  id: string;
  url: string;
  deepCrawl?: boolean;
  testData?: TestDataEntry[];
  focus?: ElementRef[];
}): Promise<PipelineResult> {
  return withPersistence(() =>
    runPersistedPipeline(job.id, job.url, job.deepCrawl ?? false, job.testData, job.focus),
  );
}

async function runPersistedPipeline(
  jobId: string,
  url: string,
  deepCrawl: boolean,
  testData?: TestDataEntry[],
  focus?: ElementRef[],
): Promise<PipelineResult> {
  const runId = `run-${jobId}`;
  const runDir = path.join(RUNNER_TESTS_DIR, runId);

  try {
    await safeWrite('markJobStarted', () => markJobStarted(jobId));
    announcePhase(jobId, 'crawling');
    const appMap = await withMeasuredStep({ jobId }, 'crawl', () => crawlForJob(url, deepCrawl), () => ({ success: true }));
    await safeWrite('setAppMap', () => setAppMap(jobId, appMap));

    const resolvedData = testData && testData.length > 0 ? resolveTestData(appMap, testData) : undefined;

    announcePhase(jobId, 'planning');
    const testPlan = await withLlmStep({ jobId }, 'plan', () =>
      planTests(appMap, { testData, focus }),
    );
    await safeWrite('setTestPlan', () => setTestPlan(jobId, testPlan));
    announcePhase(jobId, 'generating');

    type Origin = 'compiled' | 'llm' | 'corrected' | 'baseline';

    interface TestState {
      testCase: TestCase;
      filename: string;
      code: string;
      origin: Origin;
      elementsInScope: ScopedElement[];
      attempts: TestAttempt[];
      priorErrors: string[];
      status: 'open' | 'passed' | 'failed' | 'gave_up';
      recorded: boolean;
    }

    const tests: TestState[] = [];

    // Round 0: compileTest for every LLM case (CompileError → generateTest LLM fallback, origin 'llm');
    // add baseline tests from WP7 if present (origin 'baseline').
    for (const testCase of testPlan.testCases) {
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
        const filename = (testCase as { filename?: string }).filename ?? `${testCase.id}.spec.ts`;
        const code = (testCase as { code?: string }).code ?? '';
        tests.push({
          testCase,
          filename,
          code,
          origin: 'baseline',
          elementsInScope,
          attempts: [],
          priorErrors: [],
          status: 'open',
          recorded: false,
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
            () => generateTest(testCase, elementsInScope, appMap.url),
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
        origin,
        elementsInScope,
        attempts: [],
        priorErrors: [],
        status: 'open',
        recorded: false,
      });
    }

    for (let round = 1; round <= 3; round++) {
      const open = tests.filter((t) => t.status === 'open');
      if (open.length === 0) break;

      // a) findUnsafeConstructs on all open tests (cheap AST check)
      for (const test of open) {
        const unsafe = findUnsafeConstructs(test.code, test.filename);
        if (unsafe.length > 0) {
          test.attempts.push({
            attemptNumber: round,
            code: test.code,
            validationPassed: false,
            validationErrors: unsafe,
            corrected: test.origin === 'corrected',
          });
          if (round < 3 && test.origin !== 'baseline') {
            const context = { jobId, testCaseId: test.testCase.id, attemptNumber: round };
            const errorText = unsafe.join('\n');
            const correction = await withLlmStep(context, 'correct', () =>
              correctTest(test.code, errorText, test.elementsInScope, test.priorErrors),
            );
            test.priorErrors.push(errorText);
            if (test.priorErrors.length > 2) test.priorErrors.splice(0, test.priorErrors.length - 2);
            if (
              correction.code &&
              correctionPreservesAssertions(test.code, correction.code) &&
              correctionPreservesSecrets(test.code, correction.code)
            ) {
              test.code = correction.code;
              test.origin = 'corrected';
            } else {
              test.status = 'gave_up';
            }
          } else {
            test.status = 'gave_up';
          }
        }
      }

      // b) tsc ONLY for origin 'llm' | 'corrected', all of them in ONE validateTestCode call.
      // Compiled and baseline code skip tsc.
      const needsTsc = open.filter(
        (t) => t.status === 'open' && (t.origin === 'llm' || t.origin === 'corrected'),
      );
      if (needsTsc.length > 0) {
        const startTsc = Date.now();
        const filesToValidate = needsTsc.map((t) => ({ filename: t.filename, code: t.code }));
        const validationResult = await validateTestCode(runId, filesToValidate);
        const batchLatency = Date.now() - startTsc;
        const perTestLatency = Math.round(batchLatency / needsTsc.length);

        for (const test of needsTsc) {
          const fileErrors = validationResult.perFile.get(test.filename) ?? [];
          const isValid = fileErrors.length === 0;

          await recordStep({
            jobId,
            testCaseId: test.testCase.id,
            attemptNumber: round,
            stepType: 'validate',
            status: isValid ? 'success' : 'failure',
            latencyMs: perTestLatency,
            errorDetail: isValid ? undefined : fileErrors.join('\n'),
          });

          if (!isValid) {
            // c) invalid → push attempt; if round < 3 and origin !== 'baseline' → correctTest → origin 'corrected', stays open; else gave_up
            test.attempts.push({
              attemptNumber: round,
              code: test.code,
              validationPassed: false,
              validationErrors: fileErrors,
              corrected: test.origin === 'corrected',
            });

            if (round < 3 && test.origin !== 'baseline') {
              const context = { jobId, testCaseId: test.testCase.id, attemptNumber: round };
              const errorText = fileErrors.join('\n');
              const correction = await withLlmStep(context, 'correct', () =>
                correctTest(test.code, errorText, test.elementsInScope, test.priorErrors),
              );
              test.priorErrors.push(errorText);
              if (test.priorErrors.length > 2) test.priorErrors.splice(0, test.priorErrors.length - 2);
              if (
                correction.code &&
                correctionPreservesAssertions(test.code, correction.code) &&
                correctionPreservesSecrets(test.code, correction.code)
              ) {
                test.code = correction.code;
                test.origin = 'corrected';
              } else {
                test.status = 'gave_up';
              }
            } else {
              test.status = 'gave_up';
            }
          }
        }
      }

      // d) valid → ONE executeTests(runId, validFiles, { secrets, timeoutMs: min(30_000 + n*25_000, 300_000) })
      // On RunnerError (crash, timeout, NO_RESULTS) → re-run THIS round per test
      const validTests = open.filter((t) => t.status === 'open');
      if (validTests.length > 0) {
        await safeWrite('updateJobStatus:executing', () => updateJobStatus(jobId, 'executing'));
        announcePhase(jobId, 'executing');

        const timeoutMs = Math.min(30_000 + validTests.length * 25_000, 300_000);
        const validFiles = validTests.map((t) => ({ filename: t.filename, code: t.code }));

        let executionResult: { success: boolean; results: TestCaseResult[] };
        try {
          executionResult = await executeTests(runId, validFiles, {
            secrets: resolvedData?.secrets,
            timeoutMs,
          });
        } catch (err) {
          if (err instanceof RunnerError) {
            console.warn(
              `[Runner] Batch execution failed with ${err.code}: ${err.message}. Re-running round ${round} per test.`,
            );
            const fallbackResults: TestCaseResult[] = [];
            for (const test of validTests) {
              try {
                const singleRes = await executeTests(
                  runId,
                  [{ filename: test.filename, code: test.code }],
                  {
                    secrets: resolvedData?.secrets,
                    timeoutMs: Math.min(30_000 + 25_000, 300_000),
                  },
                );
                fallbackResults.push(...singleRes.results);
              } catch (singleErr) {
                fallbackResults.push({
                  testCaseId: test.testCase.id,
                  passed: false,
                  durationMs: 0,
                  error: singleErr instanceof Error ? singleErr.message : String(singleErr),
                  failureClass: 'other',
                });
              }
            }
            executionResult = {
              success: fallbackResults.length > 0 && fallbackResults.every((r) => r.passed),
              results: fallbackResults,
            };
          } else {
            throw err;
          }
        }

        // e) per result: passed → passed; failureClass 'finding' → failed;
        //    baseline → (finding ? failed : gave_up), never corrected;
        //    else if round < 3 → correct (sequential) → open; else gave_up
        for (const test of validTests) {
          const testCaseIdFromFilename = test.filename.replace(/\.spec\.ts$/, '');
          const result =
            executionResult.results.find(
              (r) => r.testCaseId === test.testCase.id || r.testCaseId === testCaseIdFromFilename,
            ) ?? executionResult.results[0];

          const execPassed = Boolean(result?.passed);
          const execError = result?.error;
          const failureClass = result?.failureClass;
          const durationMs = result?.durationMs ?? 0;

          await recordStep({
            jobId,
            testCaseId: test.testCase.id,
            attemptNumber: round,
            stepType: 'execute',
            status: execPassed ? 'success' : 'failure',
            latencyMs: durationMs,
            errorDetail: execPassed ? undefined : (execError ?? 'Execution failed'),
          });

          test.attempts.push({
            attemptNumber: round,
            code: test.code,
            validationPassed: true,
            executionPassed: execPassed,
            ...(execError ? { executionError: execError } : {}),
            ...(failureClass ? { failureClass } : {}),
            durationMs,
            corrected: test.origin === 'corrected',
          });

          if (execPassed) {
            console.log(
              `[Runner] ${test.testCase.id} | round ${round}${test.origin === 'corrected' ? ' | corrected' : ''} | execute: PASS`,
            );
            test.status = 'passed';
          } else if (failureClass === 'finding') {
            console.warn(
              `[Runner] ${test.testCase.id} | round ${round} | execute: FAIL (finding)`,
            );
            test.status = 'failed';
          } else if (test.origin === 'baseline') {
            test.status = 'gave_up';
          } else if (round < 3) {
            const context = { jobId, testCaseId: test.testCase.id, attemptNumber: round };
            const errorText = execError || 'Test execution failed';
            const correction = await withLlmStep(context, 'correct', () =>
              correctTest(test.code, errorText, test.elementsInScope, test.priorErrors),
            );
            test.priorErrors.push(errorText);
            if (test.priorErrors.length > 2) test.priorErrors.splice(0, test.priorErrors.length - 2);
            if (
              correction.code &&
              correctionPreservesAssertions(test.code, correction.code) &&
              correctionPreservesSecrets(test.code, correction.code)
            ) {
              test.code = correction.code;
              test.origin = 'corrected';
            } else {
              test.status = 'gave_up';
            }
          } else {
            test.status = 'gave_up';
          }
        }
      }

      // f) a test that reaches a final status → recordGeneratedTest + test_completed event immediately
      for (const test of tests) {
        if (test.status !== 'open' && !test.recorded) {
          test.recorded = true;
          const finalStatus = test.status;
          await safeWrite('recordGeneratedTest', () =>
            recordGeneratedTest({
              jobId,
              testCaseId: test.testCase.id,
              filename: test.filename,
              finalCode: test.code,
              finalStatus,
              attempts: test.attempts,
            }),
          );
          publishJobEvent(jobId, {
            type: 'test_completed',
            data: {
              testCaseId: test.testCase.id,
              status: finalStatus,
              totalAttempts: test.attempts.length,
            },
          });
        }
      }
    }

    for (const test of tests) {
      if (!test.recorded) {
        const finalStatus = test.status === 'open' ? 'gave_up' : test.status;
        test.status = finalStatus;
        test.recorded = true;
        await safeWrite('recordGeneratedTest', () =>
          recordGeneratedTest({
            jobId,
            testCaseId: test.testCase.id,
            filename: test.filename,
            finalCode: test.code,
            finalStatus,
            attempts: test.attempts,
          }),
        );
        publishJobEvent(jobId, {
          type: 'test_completed',
          data: {
            testCaseId: test.testCase.id,
            status: finalStatus,
            totalAttempts: test.attempts.length,
          },
        });
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

    await safeWrite('completeJob', () => completeJob(jobId));
    publishJobEvent(jobId, { type: 'job_finished', data: { status: 'completed', errorCode: null } });
    return { jobId, appMap, testPlan, generatedTests };
  } catch (error) {
    const code = toJobErrorCode(error);
    await safeWrite('failJob', () => failJob(jobId, code, error instanceof Error ? error.message : String(error)));
    publishJobEvent(jobId, { type: 'job_finished', data: { status: 'failed', errorCode: code } });
    throw error;
  } finally {
    try {
      await rm(runDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
