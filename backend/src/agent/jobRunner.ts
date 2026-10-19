import { runPipeline, toJobErrorCode, type PipelineResult } from './pipeline.ts';
import { openJobChannel } from './jobEvents.ts';
import { withRequestLlmKeys, type RequestLlmKeys } from '../llm/requestKeys.ts';
import { deliverJobWebhook, type WebhookTarget, type JobWebhookPayload } from '../notify/webhook.ts';
import { JobCancelledError, registerJob, release } from './cancellation.ts';
import { prisma } from '../db/client.ts';

import type { ElementRef, TestDataEntry } from '../api/schemas.ts';

export interface QueuedJob {
  id: string;
  url: string;
  deepCrawl?: boolean;
  fresh?: boolean;
  testData?: TestDataEntry[];
  focus?: ElementRef[];
}

export type RunOne = (job: QueuedJob, signal?: AbortSignal) => Promise<Pick<PipelineResult, 'generatedTests'> | void>;

export interface RunGroupOptions {
  webhook?: WebhookTarget;
  runOne?: RunOne;
  onSettled?: () => void;
}

const inFlightJobIds = new Set<string>();

export function inFlightJobs(): string[] {
  return [...inFlightJobIds];
}

function webhookPayload(
  job: QueuedJob,
  outcome: { result: Pick<PipelineResult, 'generatedTests'> | void } | { error: unknown },
): JobWebhookPayload {
  const finishedAt = new Date().toISOString();
  if ('error' in outcome) {
    return {
      event: 'job.finished',
      jobId: job.id,
      targetUrl: job.url,
      finishedAt,
      status: 'failed',
      errorCode: toJobErrorCode(outcome.error),
    };
  }
  const tests = outcome.result?.generatedTests ?? [];
  let passed = 0;
  let failed = 0;
  let gaveUp = 0;
  let needsReview = 0;
  for (const t of tests) {
    if (t.status === 'passed') passed += 1;
    else if (t.status === 'failed') failed += 1;
    else if (t.status === 'needs_review') needsReview += 1;
    else gaveUp += 1;
  }
  return {
    event: 'job.finished',
    jobId: job.id,
    targetUrl: job.url,
    finishedAt,
    status: 'completed',
    tests: {
      total: tests.length,
      passed,
      failed,
      gaveUp,
      needsReview,
    },
  };
}

/**
 * Starts a run group detached from the HTTP request.
 *
 * Contract: the caller has already acquired ONE pipelineGate slot and the
 * job rows already exist (status 'pending'). Ownership of the slot transfers
 * here and is released exactly once, when the whole group settles.
 *
 * withRequestLlmKeys is entered INSIDE this function, so the BYOK
 * AsyncLocalStorage context is established on the detached promise chain
 * itself and never depends on the request's async scope.
 *
 * `runOne` is injectable for scratch verification only; production uses runPipeline.
 */
export function startDetachedRun(
  jobs: readonly QueuedJob[],
  keys: RequestLlmKeys,
  { webhook, runOne = runPipeline, onSettled }: RunGroupOptions = {},
): void {
  for (const job of jobs) {
    inFlightJobIds.add(job.id);
    openJobChannel(job.id);
  }

  const notify = (p: JobWebhookPayload) => {
    if (webhook) void deliverJobWebhook(webhook, p);
  };

  const run = withRequestLlmKeys(keys, async () => {
    for (const job of jobs) {
      try {
        if (runOne === runPipeline) {
          const dbJob = await prisma.job.findUnique({
            where: { id: job.id },
            select: { status: true },
          }).catch(() => null);
          if (dbJob?.status === 'cancelled') {
            continue;
          }
        }

        const signal = registerJob(job.id);
        if (signal.aborted) {
          continue;
        }

        try {
          const result = await runOne(job, signal);
          notify(webhookPayload(job, { result }));
        } catch (error) {
          if (error instanceof JobCancelledError || signal.aborted) {
            notify({
              event: 'job.finished',
              jobId: job.id,
              targetUrl: job.url,
              finishedAt: new Date().toISOString(),
              status: 'cancelled',
              errorCode: null,
            });
          } else {
            console.warn(`[JobRunner] ${job.id} failed: ${error instanceof Error ? error.message : String(error)}`);
            notify(webhookPayload(job, { error }));
          }
        } finally {
          release(job.id);
        }
      } finally {
        inFlightJobIds.delete(job.id);
      }
    }
  });

  void run
    .catch((error: unknown) => {
      console.error('[JobRunner] run group crashed:', error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      for (const job of jobs) inFlightJobIds.delete(job.id);
      onSettled?.();
    });
}
// Module component implementation.
