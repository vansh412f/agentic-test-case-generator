import type { LoadedJob } from '../db/jobs.ts';
import { summarizeTokenUsage } from './tokenUsage.ts';
import type { TokenUsage } from './tokenUsage.ts';
import { scoreTestConfidence } from './confidence.ts';
import type { ConfidenceScore } from './confidence.ts';
import { isTerminal } from '../api/jobStream.ts';
import { runQueue } from './runQueue.ts';
import { sanitizeError } from '../runner/sanitizeError.ts';
import { summarizeFailure, type FailureSummary } from '../report/failureSummary.ts';
import { traceForAttempt } from '../runner/traceStore.ts';
import { config } from '../config.ts';

type PersistedTest = LoadedJob['generatedTests'][number];
type PersistedAttempt = PersistedTest['executionResults'][number];

export interface JobDetailAttempt extends PersistedAttempt {
  failureSummary?: FailureSummary;
  traceExpiresAt?: string;
}

export interface JobDetailTest extends Omit<PersistedTest, 'executionResults'> {
  confidence: ConfidenceScore;
  failureSummary?: FailureSummary;
  executionResults: JobDetailAttempt[];
}

export interface JobDetail extends Omit<LoadedJob, 'generatedTests' | 'visitorId'> {
  usedOwnKeys: boolean;
  tokenUsage: TokenUsage;
  generatedTests: JobDetailTest[];
  queuePosition: number | null;
  runGroupId: string | null;
  groupRemainingJobs?: number;
  canCancel: boolean;
}

export interface BuildJobDetailOptions {
  viewerVisitorId?: string | null;
  groupRemainingJobs?: number;
}

// Presentation enrichment for GET /api/jobs/:id. The repository stays pure
// data access; cost and confidence are derived here, on read, from the
// persisted steps/tests — nothing is stored back.
export function buildJobDetail(
  job: LoadedJob,
  options?: BuildJobDetailOptions,
): JobDetail {
  const { visitorId, ...rest } = job;
  const terminal = isTerminal(job.status);
  const canCancel = Boolean(
    options?.viewerVisitorId &&
      visitorId &&
      options.viewerVisitorId === visitorId &&
      !terminal,
  );

  return {
    ...rest,
    runGroupId: job.runGroupId ?? null,
    queuePosition: runQueue.positionOf(job.id),
    canCancel,
    groupRemainingJobs: options?.groupRemainingJobs,
    usedOwnKeys: Boolean(job.usedOwnKeys),
    tokenUsage: summarizeTokenUsage(job.agentSteps),
    generatedTests: job.generatedTests.map((test: PersistedTest) => {
      const sortedAttempts: JobDetailAttempt[] = [...test.executionResults]
        .sort((a, b) => a.attemptNumber - b.attemptNumber)
        .map((attempt) => {
          const sanitizedError = attempt.executionError
            ? sanitizeError(attempt.executionError)
            : attempt.executionError;
          const failureSummary = sanitizedError
            ? summarizeFailure(sanitizedError)
            : undefined;
          return {
            ...attempt,
            executionError: sanitizedError,
            failureSummary,
          };
        });

      const lastAttempt = sortedAttempts[sortedAttempts.length - 1];
      const failureSummary = lastAttempt?.failureSummary;

      // Add traceExpiresAt for EVERY attempt with a live trace (owner/local-unclaimed only)
      const isOwner = Boolean(visitorId && options?.viewerVisitorId && options.viewerVisitorId === visitorId);
      const isLocalUnclaimed = !visitorId && config.LOCAL_AGENT_MODE;
      if (isOwner || isLocalUnclaimed) {
        const effectiveOwner = visitorId ?? '';
        for (const attempt of sortedAttempts) {
          const traceEntry = traceForAttempt(job.id, test.testCaseId, attempt.attemptNumber, effectiveOwner);
          if (traceEntry) {
            attempt.traceExpiresAt = new Date(traceEntry.expiresAt).toISOString();
          }
        }
      }

      return {
        ...test,
        failureSummary,
        executionResults: sortedAttempts,
        confidence: scoreTestConfidence({
          code: test.finalCode,
          finalStatus: test.finalStatus,
          attempts: sortedAttempts,
        }),
      };
    }),
  };
}
