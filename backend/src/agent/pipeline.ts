import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { crawlPage } from '../crawler/pageCrawler.ts';
import { planTests } from './steps/planner.ts';
import { generateTest } from './steps/generator.ts';
import type { GeneratedTest } from './steps/generator.ts';
import { correctTest, correctionPreservesAssertions } from './steps/corrector.ts';
import { validateTestCode } from '../runner/validator.ts';
import { executeTests, type FailureClass } from '../runner/executor.ts';
import { RUNNER_TESTS_DIR } from '../runner/config.ts';
import type { AppMap, InteractiveElement } from '../crawler/types.ts';
import type { TestPlan } from './prompts/plannerPrompt.ts';
import type { ScopedElement } from './types.ts';
import { scoreTestConfidence } from './confidence.ts';
import type { ConfidenceScore } from './confidence.ts';
import { createJob, updateJobStatus, setAppMap, setTestPlan, completeJob, failJob } from '../db/jobs.ts';
import { recordGeneratedTest } from '../db/generatedTests.ts';
import { safeWrite, withPersistence } from '../db/safeWrite.ts';
import { withLlmStep, withMeasuredStep } from './persistence.ts';
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

export function runPipeline(url: string): Promise<PipelineResult> {
  return withPersistence(() => runPersistedPipeline(url));
}

async function runPersistedPipeline(url: string): Promise<PipelineResult> {
  const jobId = randomUUID();
  const runId = `run-${jobId}`;
  const runDir = path.join(RUNNER_TESTS_DIR, runId);

  try {
    await safeWrite('createJob', () => createJob({ id: jobId, targetUrl: url }));
    const appMap = await withMeasuredStep({ jobId }, 'crawl', () => crawlPage(url), () => ({ success: true }));
    await safeWrite('setAppMap', () => setAppMap(jobId, appMap));
    const testPlan = await withLlmStep({ jobId }, 'plan', () => planTests(appMap));
    await safeWrite('setTestPlan', () => setTestPlan(jobId, testPlan));

    const generatedTests: GeneratedTestResult[] = [];

    for (const testCase of testPlan.testCases) {
      // Slice App Map elements to only those referenced by this test case
      const referencedIds = new Set(
        testCase.steps
          .map((step) => step.elementId)
          .filter((id): id is string => id !== null),
      );

      const elementsInScope = projectElementScope(
        appMap.elements.filter((elem) => referencedIds.has(elem.id)),
      );

      // Initial generation
      await safeWrite('updateJobStatus:generating', () => updateJobStatus(jobId, 'generating'));
      const initialGen = await withLlmStep(
        { jobId, testCaseId: testCase.id }, 'generate',
        () => generateTest(testCase, elementsInScope, appMap.url),
      );
      const filename = initialGen.filename;
      let currentCode = initialGen.code;
      const attempts: TestAttempt[] = [];
      const maxCorrections = 2;
      let finalStatus: 'passed' | 'failed' | 'gave_up' = 'gave_up';

      for (let attempt = 1; attempt <= 1 + maxCorrections; attempt++) {
        const isCorrected = attempt > 1;

        // Step A: Static validation
        const context = { jobId, testCaseId: testCase.id, attemptNumber: attempt };
        const validationResult = await withMeasuredStep(
          context, 'validate',
          () => validateTestCode(runId, [{ filename, code: currentCode }]),
          (result) => ({ success: result.valid, error: result.errors.join('\n') || undefined }),
        );

        if (!validationResult.valid) {
          attempts.push({
            attemptNumber: attempt,
            code: currentCode,
            validationPassed: false,
            validationErrors: validationResult.errors,
            corrected: isCorrected,
          });

          const firstErr = validationResult.errors[0]?.split('\n')[0] || 'validation error';
          console.warn(
            `[Runner] ${testCase.id} | attempt ${attempt}${isCorrected ? ' | corrected' : ''} | validate: FAIL (${firstErr})`,
          );

          if (attempt <= maxCorrections) {
            const errorText = validationResult.errors.join('\n');
            const correction = await withLlmStep(context, 'correct',
              () => correctTest(currentCode, errorText, elementsInScope));
            if (correction.code) {
              if (!correctionPreservesAssertions(currentCode, correction.code)) {
                console.warn(
                  `[Runner] ${testCase.id} | correction rejected: assertions altered`,
                );
              } else {
                currentCode = correction.code;
                continue;
              }
            }
          }

          finalStatus = 'gave_up';
          break;
        }

        // Step B: Execution
        await safeWrite('updateJobStatus:executing', () => updateJobStatus(jobId, 'executing'));
        const executionResult = await withMeasuredStep(
          context, 'execute',
          () => executeTests(runId, [{ filename, code: currentCode }]),
          (result) => ({ success: result.success, error: result.results.find((r) => !r.passed)?.error }),
        );
        const testCaseResult =
          executionResult.results.find((r) => r.testCaseId === testCase.id) ??
          executionResult.results[0];

        const execPassed = Boolean(testCaseResult?.passed);
        const execError = testCaseResult?.error;
        const failureClass = testCaseResult?.failureClass;

        attempts.push({
          attemptNumber: attempt,
          code: currentCode,
          validationPassed: true,
          executionPassed: execPassed,
          ...(execError ? { executionError: execError } : {}),
          ...(failureClass ? { failureClass } : {}),
          ...(typeof testCaseResult?.durationMs === 'number'
            ? { durationMs: testCaseResult.durationMs }
            : {}),
          corrected: isCorrected,
        });

        if (execPassed) {
          console.log(
            `[Runner] ${testCase.id} | attempt ${attempt}${isCorrected ? ' | corrected' : ''} | validate: PASS | execute: PASS`,
          );
          finalStatus = 'passed';
          break;
        }

        const firstErr = execError?.split('\n')[0] || 'execution failure';
        console.warn(
          `[Runner] ${testCase.id} | attempt ${attempt}${isCorrected ? ' | corrected' : ''} | validate: PASS | execute: FAIL (${firstErr})`,
        );

        if (failureClass === 'finding') {
          finalStatus = 'failed';
          break;
        }

        if (attempt <= maxCorrections) {
          const correction = await withLlmStep(context, 'correct', () => correctTest(
            currentCode,
            execError || 'Test execution failed',
            elementsInScope,
          ));
          if (correction.code) {
            if (!correctionPreservesAssertions(currentCode, correction.code)) {
              console.warn(
                `[Runner] ${testCase.id} | correction rejected: assertions altered`,
              );
            } else {
              currentCode = correction.code;
              continue;
            }
          }
        }

        finalStatus = 'gave_up';
        break;
      }

      await safeWrite('recordGeneratedTest', () => recordGeneratedTest({
        jobId, testCaseId: testCase.id, filename, finalCode: currentCode,
        finalStatus, attempts,
      }));

      generatedTests.push({
        testCaseId: testCase.id,
        filename,
        code: currentCode,
        status: finalStatus,
        attempts,
        confidence: scoreTestConfidence({ code: currentCode, finalStatus, attempts }),
      });
    }

    await safeWrite('completeJob', () => completeJob(jobId));
    return { jobId, appMap, testPlan, generatedTests };
  } catch (error) {
    const code = error instanceof CrawlError || error instanceof LlmError || error instanceof RunnerError
      ? error.code : 'INTERNAL_ERROR';
    await safeWrite('failJob', () => failJob(jobId, code, error instanceof Error ? error.message : String(error)));
    throw error;
  } finally {
    try {
      await rm(runDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
