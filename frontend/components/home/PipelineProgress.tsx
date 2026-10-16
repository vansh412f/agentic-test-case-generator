import {
  Bot,
  CheckCircle2,
  CircleDashed,
  Globe2,
  ListChecks,
  Loader2,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDurationMs } from '@/lib/utils';
import type { JobDetail, StepType } from '@/types/api';

interface PipelineProgressProps {
  job: JobDetail | undefined;
  jobId: string | null;
  startedAt: number | null;
  submittedUrls: string[];
}

const phases: Array<{
  id: string;
  label: string;
  description: string;
  stepTypes: StepType[];
  icon: typeof Globe2;
}> = [
  {
    id: 'crawling',
    label: 'Crawling',
    description: 'Mapping visible interactive elements',
    stepTypes: ['crawl'],
    icon: Globe2,
  },
  {
    id: 'planning',
    label: 'Planning',
    description: 'Selecting high-value user journeys',
    stepTypes: ['plan'],
    icon: ListChecks,
  },
  {
    id: 'generating',
    label: 'Generating & validating',
    description: 'Writing and type-checking Playwright specs',
    stepTypes: ['generate', 'validate', 'correct'],
    icon: Bot,
  },
  {
    id: 'executing',
    label: 'Executing',
    description: 'Running tests in an isolated browser',
    stepTypes: ['execute'],
    icon: PlayCircle,
  },
];

function phaseState(
  job: JobDetail | undefined,
  phaseIndex: number,
): 'complete' | 'active' | 'pending' | 'failed' {
  if (job === undefined) return phaseIndex === 0 ? 'active' : 'pending';

  const stepTypes = phases[phaseIndex]?.stepTypes ?? [];
  const hasStep = job.agentSteps.some((step) => stepTypes.includes(step.stepType));

  if (job.status === 'completed') return 'complete';

  const currentIndex =
    job.status === 'crawling'
      ? 0
      : job.status === 'planning'
        ? 1
        : job.status === 'generating'
          ? 2
          : job.status === 'executing'
            ? 3
            : phaseIndex;

  if (job.status === 'failed' && phaseIndex === currentIndex) return 'failed';
  if (hasStep && phaseIndex < currentIndex) return 'complete';
  if (phaseIndex === currentIndex) return 'active';
  return hasStep ? 'complete' : 'pending';
}

export function PipelineProgress({
  job,
  jobId,
  startedAt,
  submittedUrls,
}: PipelineProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);
  const latestStep = job?.agentSteps[job.agentSteps.length - 1];

  return (
    <section aria-labelledby="pipeline-progress-title" className="panel p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-caption uppercase tracking-widest text-brand-strong dark:text-brand">
            Agent working
          </p>
          <h2 className="mt-2 text-heading-2 font-bold" id="pipeline-progress-title">
            Building your test suite
          </h2>
          <p className="mt-1 max-w-reading text-small text-muted-foreground">
            {submittedUrls.length === 1
              ? submittedUrls[0]
              : `${submittedUrls.length} pages are being processed as separate jobs.`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-full border px-3 py-1 font-mono text-caption">
            {formatDurationMs(elapsed)}
          </span>
          {job ? <StatusBadge status={job.status} /> : null}
        </div>
      </div>

      <ol className="mt-7 space-y-0">
        {phases.map((phase, index) => {
          const state = phaseState(job, index);
          const Icon = phase.icon;

          return (
            <li className="relative flex gap-4 pb-6 last:pb-0" key={phase.id}>
              {index < phases.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute left-5 top-11 h-[calc(100%-2.25rem)] w-px bg-border"
                />
              ) : null}

              <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-surface">
                {state === 'complete' ? (
                  <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-success" />
                ) : state === 'failed' ? (
                  <XCircle aria-hidden="true" className="h-5 w-5 text-danger" />
                ) : state === 'active' ? (
                  <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-info" />
                ) : (
                  <CircleDashed aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
                )}
              </span>

              <div className="min-w-0 flex-1 pt-1">
                <p className="flex items-center gap-2 font-semibold">
                  <Icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  {phase.label}
                </p>
                <p className="mt-1 text-small text-muted-foreground">
                  {phase.description}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div aria-live="polite" className="mt-6 rounded-panel border bg-background p-4 font-mono text-small">
        {job === undefined ? (
          <p>
            Waiting for the backend to register the job… The synchronous
            generation request is already running.
          </p>
        ) : latestStep === undefined ? (
          <p>Job registered. Waiting for the first agent step…</p>
        ) : (
          <p>
            Latest: {latestStep.stepType}
            {latestStep.testCaseId ? ` · ${latestStep.testCaseId}` : ''}
            {latestStep.llmProvider ? ` · ${latestStep.llmProvider}` : ''}
            {latestStep.llmModel ? ` / ${latestStep.llmModel}` : ''}
            {' · '}
            {job.agentSteps.length} agent steps recorded
          </p>
        )}
      </div>

      {job?.status === 'failed' ? (
        <div className="mt-4 rounded-panel border border-danger/40 bg-danger/10 p-4 text-small">
          <p className="font-semibold text-danger">Pipeline failed</p>
          <p className="mt-1">
            {job.errorCode ? `${job.errorCode}: ` : ''}
            {job.errorMessage ?? 'The backend did not provide an error message.'}
          </p>
          {jobId ? (
            <Link className="mt-3 inline-flex font-semibold underline" href={`/jobs/${jobId}`}>
              Open partial job details
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
