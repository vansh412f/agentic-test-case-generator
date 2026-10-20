import type { JobDetail, JobStatus } from '@/types/api';

export const PIPELINE_STEPS = ['Crawl', 'Plan', 'Generate', 'Validate', 'Execute', 'Correct'];

export const STEP_TITLES = [
  'Mapping interactive elements',
  'Planning user journeys',
  'Writing Playwright tests',
  'Validating assertions with TypeScript',
  'Executing in Chromium',
  'Self-correcting mechanical failures',
  'Suite generation complete',
];

export function getActiveStepIndex(
  job: Pick<JobDetail, 'status' | 'agentSteps'> | undefined,
  liveStatus?: JobStatus | null,
): number {
  const status = liveStatus ?? job?.status;
  if (!status || status === 'pending' || status === 'crawling') return 0;
  if (status === 'planning') return 1;
  if (status === 'executing') return 4;
  if (status === 'completed') return 6;

  if (status === 'generating') {
    const steps = job?.agentSteps ?? [];
    const latest = steps[steps.length - 1];
    if (latest?.stepType === 'correct') return 5;
    if (latest?.stepType === 'validate') return 3;
    if (latest?.stepType === 'execute') return 4;
    return 2;
  }

  return 2;
}

export interface PipelineProgressState {
  activeIndex: number;
  percent: number;
  isQueued: boolean;
  queuePosition: number | null;
  actionTitle: string;
}

export function computePipelineProgress(
  job: (Pick<JobDetail, 'status' | 'agentSteps'> & { queuePosition?: number | null }) | undefined,
  liveStatus?: JobStatus | null,
): PipelineProgressState {
  const activeIndex = getActiveStepIndex(job, liveStatus);
  const queuePos = job?.queuePosition ?? null;
  const isQueued =
    (job?.status === 'pending' || liveStatus === 'pending') &&
    typeof queuePos === 'number' &&
    queuePos > 0;

  const actionTitle = isQueued
    ? `Waiting in line · #${queuePos}`
    : (STEP_TITLES[Math.min(activeIndex, 6)] ?? 'Processing');

  const percent = isQueued
    ? 0
    : Math.min(100, Math.round(((Math.min(activeIndex, 5) + 1) / PIPELINE_STEPS.length) * 100));

  return {
    activeIndex,
    percent,
    isQueued,
    queuePosition: queuePos,
    actionTitle,
  };
}
