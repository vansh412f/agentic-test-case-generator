import type { TestCase } from './prompts/plannerPrompt.ts';
import type { ScopedElement } from './types.ts';
import type { FailureClass, TestCaseResult } from '../runner/executor.ts';

export interface TestAttempt {
  attemptNumber: number;
  code: string;
  validationPassed: boolean;
  validationErrors?: string[];
  executionPassed?: boolean;
  executionError?: string;
  failureClass?: FailureClass;
  durationMs?: number;
  corrected: boolean;
  gaveUpReason?: string;
}

export interface RoundTest {
  testCase: TestCase;
  filename: string;
  code: string;
  codeVersion: number;
  validatedVersion: number;
  origin: 'compiled' | 'llm' | 'baseline' | 'corrected';
  elementsInScope: ScopedElement[];
  attempts: TestAttempt[];
  priorErrors: string[];
  status: 'open' | 'passed' | 'failed' | 'gave_up';
  recorded: boolean;
}

export function pushAttempt(
  test: RoundTest,
  partial: Omit<TestAttempt, 'attemptNumber'>,
): TestAttempt {
  const attemptNumber = test.attempts.length + 1;
  const attempt: TestAttempt = {
    ...partial,
    attemptNumber,
  };
  test.attempts.push(attempt);
  return attempt;
}

export interface RoundDeps {
  checkSafety: (code: string, filename: string) => string[];
  validateBatch: (files: Array<{ filename: string; code: string }>) => Promise<{
    perFile: Map<string, string[]>;
    batchLatencyMs: number;
  }>;
  executeBatch: (files: Array<{ filename: string; code: string }>) => Promise<{
    success: boolean;
    results: TestCaseResult[];
  }>;
  correct: (params: {
    test: RoundTest;
    errorText: string;
    attemptNumber: number;
  }) => Promise<{ code: string } | null>;
  recordStep?: (step: {
    testCaseId: string;
    attemptNumber: number;
    stepType: 'validate' | 'execute';
    status: 'success' | 'failure';
    latencyMs: number;
    errorDetail?: string;
  }) => Promise<void>;
  onPhaseChange?: (phase: 'executing') => Promise<void>;
  emitTerminal?: (test: RoundTest) => Promise<void>;
  signal?: AbortSignal;
  canCorrect?: (test: RoundTest) => boolean;
}

export async function runRounds(
  tests: RoundTest[],
  deps: RoundDeps,
): Promise<void> {
  const maxRounds = 3;

  for (let round = 1; round <= maxRounds; round++) {
    deps.signal?.throwIfAborted();
    const open = tests.filter((t) => t.status === 'open');
    if (open.length === 0) break;

    // 1. Safety check on open tests whose code is not yet validated for this codeVersion
    for (const test of open) {
      deps.signal?.throwIfAborted();
      if (test.validatedVersion === test.codeVersion) {
        continue;
      }

      const unsafe = deps.checkSafety(test.code, test.filename);
      if (unsafe.length > 0) {
        const attempt = pushAttempt(test, {
          code: test.code,
          validationPassed: false,
          validationErrors: unsafe,
          corrected: test.origin === 'corrected',
        });

        const errorText = unsafe.join('\n');
        test.priorErrors.push(errorText);
        if (test.priorErrors.length > 2) {
          test.priorErrors.splice(0, test.priorErrors.length - 2);
        }

        const canProceedWithCorrection =
          round < maxRounds &&
          test.origin !== 'baseline' &&
          (deps.canCorrect ? deps.canCorrect(test) : true);

        if (!canProceedWithCorrection) {
          test.status = 'gave_up';
          if (deps.canCorrect && !deps.canCorrect(test)) {
            attempt.gaveUpReason = 'token_budget';
            attempt.executionError = (attempt.executionError ? attempt.executionError + ' ' : '') + '[gaveUpReason: token_budget]';
          }
        } else {
          const correction = await deps.correct({
            test,
            errorText,
            attemptNumber: attempt.attemptNumber,
          });
          if (correction?.code) {
            test.code = correction.code;
            test.codeVersion += 1;
            test.origin = 'corrected';
            // ValidatedVersion remains unchanged, so validatedVersion !== codeVersion
            // Test stays open but will NOT be executed in this round!
          } else {
            test.status = 'gave_up';
          }
        }
      }
    }

    // 2. Mark compiled and baseline tests as validated if they passed safety check
    for (const test of open) {
      if (
        test.status === 'open' &&
        test.validatedVersion !== test.codeVersion &&
        (test.origin === 'compiled' || test.origin === 'baseline')
      ) {
        test.validatedVersion = test.codeVersion;
      }
    }

    // 3. Batch tsc validation for tests whose current code has not been validated
    const needsTsc = open.filter(
      (t) =>
        t.status === 'open' &&
        t.validatedVersion !== t.codeVersion &&
        (t.origin === 'llm' || t.origin === 'corrected'),
    );

    if (needsTsc.length > 0) {
      deps.signal?.throwIfAborted();
      const filesToValidate = needsTsc.map((t) => ({
        filename: t.filename,
        code: t.code,
      }));
      const validationResult = await deps.validateBatch(filesToValidate);
      const perTestLatency = Math.round(
        validationResult.batchLatencyMs / needsTsc.length,
      );

      for (const test of needsTsc) {
        deps.signal?.throwIfAborted();
        const fileErrors = validationResult.perFile.get(test.filename) ?? [];
        const isValid = fileErrors.length === 0;

        if (isValid) {
          test.validatedVersion = test.codeVersion;
          await deps.recordStep?.({
            testCaseId: test.testCase.id,
            attemptNumber: test.attempts.length + 1,
            stepType: 'validate',
            status: 'success',
            latencyMs: perTestLatency,
          });
        } else {
          const attempt = pushAttempt(test, {
            code: test.code,
            validationPassed: false,
            validationErrors: fileErrors,
            corrected: test.origin === 'corrected',
          });

          await deps.recordStep?.({
            testCaseId: test.testCase.id,
            attemptNumber: attempt.attemptNumber,
            stepType: 'validate',
            status: 'failure',
            latencyMs: perTestLatency,
            errorDetail: fileErrors.join('\n'),
          });

          const errorText = fileErrors.join('\n');
          test.priorErrors.push(errorText);
          if (test.priorErrors.length > 2) {
            test.priorErrors.splice(0, test.priorErrors.length - 2);
          }

          const canProceedWithCorrection =
            round < maxRounds &&
            test.origin !== 'baseline' &&
            (deps.canCorrect ? deps.canCorrect(test) : true);

          if (!canProceedWithCorrection) {
            test.status = 'gave_up';
            if (deps.canCorrect && !deps.canCorrect(test)) {
              attempt.gaveUpReason = 'token_budget';
              attempt.executionError = (attempt.executionError ? attempt.executionError + ' ' : '') + '[gaveUpReason: token_budget]';
            }
          } else {
            const correction = await deps.correct({
              test,
              errorText,
              attemptNumber: attempt.attemptNumber,
            });
            if (correction?.code) {
              test.code = correction.code;
              test.codeVersion += 1;
              test.origin = 'corrected';
              // ValidatedVersion is not updated, so validatedVersion !== codeVersion
              // Test stays open but will NOT be executed in this round!
            } else {
              test.status = 'gave_up';
            }
          }
        }
      }
    }

    // 4. Execution phase: execute ONLY tests whose current code has been validated
    const testsToExecute = open.filter(
      (t) => t.status === 'open' && t.validatedVersion === t.codeVersion,
    );

    if (testsToExecute.length > 0) {
      await deps.onPhaseChange?.('executing');
      const validFiles = testsToExecute.map((t) => ({
        filename: t.filename,
        code: t.code,
      }));

      deps.signal?.throwIfAborted();
      const executionResult = await deps.executeBatch(validFiles);

      for (const test of testsToExecute) {
        deps.signal?.throwIfAborted();
        const testCaseIdFromFilename = test.filename.replace(/\.spec\.ts$/, '');
        const matched = executionResult.results.find(
          (r) =>
            r.testCaseId === test.testCase.id ||
            r.testCaseId === testCaseIdFromFilename,
        );

        // B20: Never fall back to results[0]
        const result: TestCaseResult = matched ?? {
          testCaseId: test.testCase.id,
          passed: false,
          durationMs: 0,
          error: 'Test case was not reported by Playwright',
          failureClass: 'other',
        };

        const execPassed = Boolean(result.passed);
        const execError = result.error;
        const failureClass = result.failureClass;
        const durationMs = result.durationMs ?? 0;

        const attempt = pushAttempt(test, {
          code: test.code,
          validationPassed: true,
          executionPassed: execPassed,
          ...(execError ? { executionError: execError } : {}),
          ...(failureClass ? { failureClass } : {}),
          durationMs,
          corrected: test.origin === 'corrected',
        });

        await deps.recordStep?.({
          testCaseId: test.testCase.id,
          attemptNumber: attempt.attemptNumber,
          stepType: 'execute',
          status: execPassed ? 'success' : 'failure',
          latencyMs: durationMs,
          errorDetail: execPassed ? undefined : (execError ?? 'Execution failed'),
        });

        if (execPassed) {
          test.status = 'passed';
        } else if (failureClass === 'finding') {
          // Real finding: never corrected
          test.status = 'failed';
        } else if (test.origin === 'baseline') {
          // Baselines: never corrected
          test.status = 'gave_up';
        } else if (round < maxRounds) {
          const canProceed = deps.canCorrect ? deps.canCorrect(test) : true;
          if (!canProceed) {
            test.status = 'gave_up';
            attempt.gaveUpReason = 'token_budget';
            attempt.executionError = (attempt.executionError ? attempt.executionError + ' ' : '') + '[gaveUpReason: token_budget]';
          } else {
            const errorText = execError || 'Test execution failed';
            test.priorErrors.push(errorText);
            if (test.priorErrors.length > 2) {
              test.priorErrors.splice(0, test.priorErrors.length - 2);
            }

            const correction = await deps.correct({
              test,
              errorText,
              attemptNumber: attempt.attemptNumber,
            });
            if (correction?.code) {
              test.code = correction.code;
              test.codeVersion += 1;
              test.origin = 'corrected';
              // Test stays open; validatedVersion is old so it will be validated in round + 1
            } else {
              test.status = 'gave_up';
            }
          }
        } else {
          test.status = 'gave_up';
        }
      }
    }

    // 5. Emit terminal events for any tests that reached final status in this round
    for (const test of tests) {
      if (test.status !== 'open' && !test.recorded) {
        await deps.emitTerminal?.(test);
      }
    }
  }

  // 6. Final sweep: any test still open after round loop gives up
  for (const test of tests) {
    if (test.status === 'open') {
      test.status = 'gave_up';
    }
    if (!test.recorded) {
      await deps.emitTerminal?.(test);
    }
  }
}
