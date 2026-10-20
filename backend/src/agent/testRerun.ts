import { randomUUID } from 'node:crypto';
import type { FailureClass as PrismaFailureClass, TestStatus } from '@prisma/client';
import { config } from '../config.ts';
import { prisma } from '../db/client.ts';
import { recordExecutionResult } from '../db/executionResults.ts';
import { validateTestCode } from '../runner/validator.ts';
import { executeTests } from '../runner/executor.ts';
import type { TestCaseResult } from '../runner/executor.ts';
import { WaitableSemaphore } from '../security/concurrencyGate.ts';
import { nextUtcMidnight } from '../security/dailyBudget.ts';
import { jobError } from '../api/jobErrors.ts';
import { isTerminal } from '../api/jobStream.ts';
import { recordServerEvent } from '../observability/serverEvents.ts';

export interface RerunInput {
  jobId: string;
  testCaseId: string;
  code: string;
  headed?: boolean;
  secrets?: Record<string, string>;
  visitorId: string | null;
  ipHash: string;
}

export interface RerunDeps {
  validate?: typeof validateTestCode;
  execute?: typeof executeTests;
}

export class RerunRateLimitError extends Error {
  readonly code = 'RATE_LIMITED';

  constructor(readonly resetsAt: string) {
    super('Daily re-run limit reached.');
    this.name = 'RerunRateLimitError';
  }
}

// D2: one rerun at a time server-wide. executeTests() has its own isolation
// lock against pipeline executions, so this queue only bounds reruns.
const rerunSemaphore = new WaitableSemaphore(1, 3, 180_000);

// `${jobId}:${testCaseId}` of reruns currently queued or executing.
const inFlight = new Set<string>();

// D5: process-local daily counters for limited mode. Keyed by
// `${visitorId}|${utcDate}` and `${ipHash}|${utcDate}`; a new UTC day naturally
// starts a fresh key, and a process restart resets them (same caveat as the
// existing in-memory reservation counters in security/dailyBudget.ts).
const rerunCounters = new Map<string, number>();

const QUEUE_TIMEOUT_MESSAGE = 'Re-run queue timed out. Try again in a moment.';
const RUNNER_FAILURE_MESSAGE = 'The test runner failed before producing a result.';
const NO_RESULT_MESSAGE = 'The test runner produced no result.';

interface RerunAttemptRecord {
  generatedTestId: string;
  attemptNumber: number;
  code: string;
  validationPassed: boolean;
  validationErrors?: string[];
  executionPassed: boolean;
  executionError: string | null;
  failureClass?: TestCaseResult['failureClass'];
  failureContext?: unknown;
  durationMs: number;
  /**
   * When set, the edited code becomes the test's final code and this becomes
   * its final status. Left undefined for validation failures and queue
   * timeouts, where the previous final code/status must survive.
   */
  finalStatus?: TestStatus;
}

function utcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function consumeRerunQuota(visitorId: string | null, ipHash: string): void {
  if (config.LOCAL_AGENT_MODE) return;

  const date = utcDateKey();
  const visitorKey = visitorId ? `${visitorId}|${date}` : null;
  const ipKey = ipHash ? `${ipHash}|${date}` : null;

  if (visitorKey) {
    rerunCounters.set(visitorKey, (rerunCounters.get(visitorKey) ?? 0) + 1);
  }
  if (ipKey) {
    rerunCounters.set(ipKey, (rerunCounters.get(ipKey) ?? 0) + 1);
  }

  const overLimit =
    (visitorKey ? (rerunCounters.get(visitorKey) ?? 0) > config.RERUN_DAILY_LIMIT : false) ||
    (ipKey ? (rerunCounters.get(ipKey) ?? 0) > config.RERUN_DAILY_LIMIT : false);

  if (overLimit) {
    throw new RerunRateLimitError(nextUtcMidnight().toISOString());
  }
}

function isBaselineTestCase(testPlan: unknown, testCaseId: string): boolean {
  if (testCaseId.startsWith('smoke-')) return true;
  const cases = (testPlan as { testCases?: Array<{ id?: string; origin?: string }> } | null)
    ?.testCases;
  if (!Array.isArray(cases)) return false;
  return cases.some((testCase) => testCase?.id === testCaseId && testCase?.origin === 'baseline');
}

// One attempt row plus the GeneratedTest counter/status update, atomically.
async function recordRerunAttempt(record: RerunAttemptRecord): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await recordExecutionResult(
      {
        generatedTestId: record.generatedTestId,
        attemptNumber: record.attemptNumber,
        code: record.code,
        validationPassed: record.validationPassed,
        ...(record.validationErrors && record.validationErrors.length > 0
          ? { validationErrors: record.validationErrors }
          : {}),
        executionPassed: record.executionPassed,
        ...(record.executionError ? { executionError: record.executionError } : {}),
        ...(record.failureClass
          ? { failureClass: record.failureClass as PrismaFailureClass }
          : {}),
        failureContext: record.failureContext ?? { source: 'rerun' },
        durationMs: record.durationMs,
        corrected: false,
      },
      tx,
    );

    await tx.generatedTest.update({
      where: { id: record.generatedTestId },
      data: {
        totalAttempts: record.attemptNumber,
        ...(record.finalStatus
          ? { finalCode: record.code, finalStatus: record.finalStatus }
          : {}),
      },
    });
  });
}

interface PerformRerunParams {
  jobId: string;
  testCaseId: string;
  generatedTestId: string;
  filename: string;
  code: string;
  attemptNumber: number;
  headed: boolean;
  secrets?: Record<string, string>;
  validate: typeof validateTestCode;
  execute: typeof executeTests;
}

async function performRerun(params: PerformRerunParams): Promise<void> {
  let release: (() => void) | null = null;
  let persisted = false;
  const { jobId, testCaseId, attemptNumber, code } = params;

  try {
    try {
      release = await rerunSemaphore.acquire();
    } catch {
      // Queue timeout: the code was never validated or executed.
      await recordRerunAttempt({
        generatedTestId: params.generatedTestId,
        attemptNumber,
        code,
        validationPassed: true,
        executionPassed: false,
        executionError: QUEUE_TIMEOUT_MESSAGE,
        durationMs: 0,
      });
      persisted = true;
      return;
    }

    const runId = `rerun-${jobId.slice(0, 8)}-${testCaseId}-${attemptNumber}-${randomUUID().slice(0, 8)}`;
    const files = [{ filename: params.filename, code }];

    // Same gate as generated code: AST safety scan + scoped tsc first.
    const validationStartedAt = Date.now();
    const validation = await params.validate(runId, files);
    const validationDurationMs = Math.max(0, Date.now() - validationStartedAt);

    if (!validation.valid) {
      await recordRerunAttempt({
        generatedTestId: params.generatedTestId,
        attemptNumber,
        code,
        validationPassed: false,
        validationErrors: validation.errors,
        executionPassed: false,
        executionError: null,
        durationMs: validationDurationMs,
      });
      persisted = true;
      return;
    }

    // The submitted code is stored as-is (token form); values only reach the
    // runner process through this transient Map, which executeTests substitutes
    // at write time and redacts from errors.
    const secretMap = new Map(Object.entries(params.secrets ?? {}));
    const outcome = await params.execute(runId, files, {
      secrets: secretMap.size > 0 ? secretMap : undefined,
      ...(params.headed ? { headless: false } : {}),
      trace: true,
      onTraceZip: async (zipPath) => { await registerTrace(zipPath, { jobId, testCaseId, attemptNumber, visitorId: input.visitorId }); }
    });

    const result = outcome.results[0];
    if (!result) {
      await recordRerunAttempt({
        generatedTestId: params.generatedTestId,
        attemptNumber,
        code,
        validationPassed: true,
        executionPassed: false,
        executionError: NO_RESULT_MESSAGE,
        durationMs: 0,
        finalStatus: 'failed',
      });
      persisted = true;
      return;
    }

    await recordRerunAttempt({
      generatedTestId: params.generatedTestId,
      attemptNumber,
      code,
      validationPassed: true,
      executionPassed: result.passed,
      executionError: result.passed ? null : (result.error ?? 'Test failed'),
      failureClass: result.failureClass,
      failureContext: { ...(result.failureContext ?? {}), source: 'rerun' },
      durationMs: result.durationMs,
      finalStatus: result.passed ? 'passed' : 'failed',
    });
    persisted = true;
  } catch (error) {
    if (!persisted) {
      try {
        await recordRerunAttempt({
          generatedTestId: params.generatedTestId,
          attemptNumber,
          code,
          validationPassed: true,
          executionPassed: false,
          executionError: RUNNER_FAILURE_MESSAGE,
          durationMs: 0,
          finalStatus: 'failed',
        });
      } catch {
        // Recording failed too; fall through to the server event below.
      }
    }
    // Never pass code, secrets or raw runner output into the event context.
    recordServerEvent(
      'error',
      'rerun:execute',
      error,
      { jobId, testCaseId, attemptNumber },
      jobId,
    );
  } finally {
    release?.();
  }
}

export async function startTestRerun(
  input: RerunInput,
  deps: RerunDeps = {},
): Promise<{ attemptNumber: number }> {
  const validate = deps.validate ?? validateTestCode;
  const execute = deps.execute ?? executeTests;

  if (!input.visitorId) throw jobError('JOB_NOT_FOUND');

  const job = await prisma.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, visitorId: true, status: true, testPlan: true },
  });
  if (!job) throw jobError('JOB_NOT_FOUND');

  const ownedByViewer = job.visitorId === input.visitorId;
  const localUnclaimed = job.visitorId === null && config.LOCAL_AGENT_MODE;
  if (!ownedByViewer && !localUnclaimed) throw jobError('JOB_NOT_FOUND');

  if (!isTerminal(job.status)) throw jobError('RERUN_NOT_READY');

  const generatedTest = await prisma.generatedTest.findUnique({
    where: { jobId_testCaseId: { jobId: job.id, testCaseId: input.testCaseId } },
    select: { id: true, filename: true, totalAttempts: true },
  });
  if (!generatedTest) throw jobError('JOB_NOT_FOUND');

  if (isBaselineTestCase(job.testPlan, input.testCaseId)) {
    throw jobError('BASELINE_NOT_EDITABLE');
  }

  const key = `${job.id}:${input.testCaseId}`;
  if (inFlight.has(key)) throw jobError('RERUN_IN_PROGRESS');

  consumeRerunQuota(input.visitorId, input.ipHash);

  inFlight.add(key);
  const attemptNumber = generatedTest.totalAttempts + 1;
  const headed = input.headed === true && config.LOCAL_AGENT_MODE;

  // D1: return immediately; the rerun runs in-process in the background and
  // the client polls the job detail until the new attempt appears.
  void performRerun({
    jobId: job.id,
    testCaseId: input.testCaseId,
    generatedTestId: generatedTest.id,
    filename: generatedTest.filename,
    code: input.code,
    attemptNumber,
    headed,
    secrets: input.secrets,
    validate,
    execute,
  })
    .catch((error) => {
      recordServerEvent(
        'error',
        'rerun:background',
        error,
        { jobId: job.id, testCaseId: input.testCaseId },
        job.id,
      );
    })
    .finally(() => {
      inFlight.delete(key);
    });

  return { attemptNumber };
}
