import path from 'node:path';
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
}

export interface PipelineResult {
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

export async function runPipeline(url: string): Promise<PipelineResult> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = path.join(RUNNER_TESTS_DIR, runId);

  try {
    const appMap = await crawlPage(url);
    const testPlan = await planTests(appMap);

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
      const initialGen = await generateTest(testCase, elementsInScope, appMap.url);
      const filename = initialGen.filename;
      let currentCode = initialGen.code;
      const attempts: TestAttempt[] = [];
      const maxCorrections = 2;
      let finalStatus: 'passed' | 'failed' | 'gave_up' = 'gave_up';

      for (let attempt = 1; attempt <= 1 + maxCorrections; attempt++) {
        const isCorrected = attempt > 1;

        // Step A: Static validation
        const validationResult = await validateTestCode(runId, [{ filename, code: currentCode }]);

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
            const correction = await correctTest(currentCode, errorText, elementsInScope);
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
        const executionResult = await executeTests(runId, [{ filename, code: currentCode }]);
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
          const correction = await correctTest(
            currentCode,
            execError || 'Test execution failed',
            elementsInScope,
          );
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

      generatedTests.push({
        testCaseId: testCase.id,
        filename,
        code: currentCode,
        status: finalStatus,
        attempts,
      });
    }

    return { appMap, testPlan, generatedTests };
  } finally {
    try {
      await rm(runDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
