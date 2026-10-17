import { runPipeline } from './pipeline.ts';
import { openJobChannel } from './jobEvents.ts';
import { withRequestLlmKeys, type RequestLlmKeys } from '../llm/requestKeys.ts';
import { pipelineGate } from '../security/concurrencyGate.ts';

export interface QueuedJob {
  id: string;
  url: string;
  deepCrawl?: boolean;
}

export type RunOne = (job: QueuedJob) => Promise<unknown>;

const inFlightJobIds = new Set<string>();

export function inFlightJobs(): string[] {
  return [...inFlightJobIds];
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
  runOne: RunOne = runPipeline,
): void {
  for (const job of jobs) {
    inFlightJobIds.add(job.id);
    openJobChannel(job.id);
  }

  const run = withRequestLlmKeys(keys, async () => {
    for (const job of jobs) {
      try {
        await runOne(job);
      } catch (error) {
        // runPipeline already persisted failJob + published job_finished.
        console.warn(`[JobRunner] ${job.id} failed: ${error instanceof Error ? error.message : String(error)}`);
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
      pipelineGate.release();
    });
}
