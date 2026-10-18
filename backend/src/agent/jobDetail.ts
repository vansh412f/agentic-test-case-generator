import type { LoadedJob } from '../db/jobs.ts';
import { summarizeTokenUsage } from './tokenUsage.ts';
import type { TokenUsage } from './tokenUsage.ts';
import { scoreTestConfidence } from './confidence.ts';
import type { ConfidenceScore } from './confidence.ts';

type PersistedTest = LoadedJob['generatedTests'][number];

export interface JobDetailTest extends PersistedTest {
  confidence: ConfidenceScore;
}

export interface JobDetail extends Omit<LoadedJob, 'generatedTests' | 'visitorId'> {
  usedOwnKeys: boolean;
  tokenUsage: TokenUsage;
  generatedTests: JobDetailTest[];
}

// Presentation enrichment for GET /api/jobs/:id. The repository stays pure
// data access; cost and confidence are derived here, on read, from the
// persisted steps/tests — nothing is stored back.
export function buildJobDetail(job: LoadedJob): JobDetail {
  const { visitorId: _visitorId, ...rest } = job;
  return {
    ...rest,
    usedOwnKeys: Boolean(job.usedOwnKeys),
    tokenUsage: summarizeTokenUsage(job.agentSteps),
    generatedTests: job.generatedTests.map((test: PersistedTest) => ({
      ...test,
      confidence: scoreTestConfidence({
        code: test.finalCode,
        finalStatus: test.finalStatus,
        attempts: [...test.executionResults].sort(
          (a, b) => a.attemptNumber - b.attemptNumber,
        ),
      }),
    })),
  };
}
