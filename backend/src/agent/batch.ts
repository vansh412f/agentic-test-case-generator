import type { PipelineResult } from './pipeline.ts';
import { CrawlError } from '../crawler/crawlErrors.ts';
import { LlmError } from '../llm/types.ts';
import { RunnerError } from '../runner/errors.ts';

// Batch cap matches the demo's 5-page ceiling. Concurrency is capped at 2:
// each job runs its own Chromium crawl plus sequential browser executions,
// and the Groq free-tier TPM window only tolerates ~3 simultaneous LLM
// requests — Gemini fallback absorbs overflow, it does not make
// unbounded parallelism free.
export const MAX_BATCH_URLS = 5;
export const BATCH_CONCURRENCY = 2;

export type BatchRunOne = (url: string) => Promise<PipelineResult>;

export interface BatchTestSummary {
  testCaseId: string;
  filename: string;
  status: 'passed' | 'failed' | 'gave_up';
  totalAttempts: number;
  confidence: number;
}

export type BatchItemResult =
  | {
      url: string;
      status: 'completed';
      jobId: string;
      testCount: number;
      passedCount: number;
      failedCount: number;
      gaveUpCount: number;
      generatedTests: BatchTestSummary[];
    }
  | {
      url: string;
      status: 'failed';
      error: { error: string; message: string };
    };

export interface BatchResult {
  results: BatchItemResult[];
  summary: { total: number; succeeded: number; failed: number };
}

// Mirrors the failJob error-code derivation in pipeline.ts: domain errors
// keep their machine code, everything else is INTERNAL_ERROR.
function batchErrorCode(error: unknown): string {
  if (error instanceof CrawlError || error instanceof LlmError || error instanceof RunnerError) {
    return error.code;
  }
  return 'INTERNAL_ERROR';
}

function summarize(url: string, result: PipelineResult): BatchItemResult {
  const count = (status: 'passed' | 'failed' | 'gave_up'): number =>
    result.generatedTests.filter((test) => test.status === status).length;
  return {
    url,
    status: 'completed',
    jobId: result.jobId,
    testCount: result.generatedTests.length,
    passedCount: count('passed'),
    failedCount: count('failed'),
    gaveUpCount: count('gave_up'),
    generatedTests: result.generatedTests.map((test) => ({
      testCaseId: test.testCaseId,
      filename: test.filename,
      status: test.status,
      totalAttempts: test.attempts.length,
      confidence: test.confidence.score,
    })),
  };
}

// Promise.allSettled semantics with a bounded worker pool: one URL's
// failure never cancels the others, result order matches input order,
// and duplicate URLs run once (they would only burn LLM quota twice).
export async function runBatch(
  urls: readonly string[],
  runOne: BatchRunOne,
  concurrency: number = BATCH_CONCURRENCY,
): Promise<BatchResult> {
  const uniqueUrls = [...new Set(urls)];
  const results: BatchItemResult[] = new Array<BatchItemResult>(uniqueUrls.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= uniqueUrls.length) return;
      const url = uniqueUrls[index] as string;
      try {
        results[index] = summarize(url, await runOne(url));
      } catch (error) {
        results[index] = {
          url,
          status: 'failed',
          error: {
            error: batchErrorCode(error),
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, uniqueUrls.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const succeeded = results.filter((result) => result.status === 'completed').length;
  return {
    results,
    summary: { total: results.length, succeeded, failed: results.length - succeeded },
  };
}
