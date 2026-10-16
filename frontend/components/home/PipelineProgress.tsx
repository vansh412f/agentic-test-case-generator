import { Check, Clock } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { formatDurationMs } from '@/lib/utils';
import type { JobDetail } from '@/types/api';

interface PipelineProgressProps {
  job: JobDetail | undefined;
  jobId: string | null;
  startedAt: number | null;
  submittedUrls: string[];
}

const steps = ['Crawl', 'Plan', 'Generate', 'Validate', 'Execute', 'Correct'];

function getActiveStepIndex(job: JobDetail | undefined): number {
  if (!job) return 1;

  if (job.status === 'crawling') return 0;
  if (job.status === 'planning') return 1;
  if (job.status === 'executing') return 4;
  if (job.status === 'completed') return 6;

  if (job.status === 'generating') {
    const latest = job.agentSteps[job.agentSteps.length - 1];
    if (latest?.stepType === 'correct') return 5;
    if (latest?.stepType === 'validate') return 3;
    if (latest?.stepType === 'execute') return 4;
    return 2;
  }

  return 2;
}

export function PipelineProgress({
  job,
  startedAt,
  submittedUrls,
}: PipelineProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);
  const active = getActiveStepIndex(job);

  const stepTitles = [
    'Mapping interactive elements',
    'Planning user journeys',
    'Writing Playwright tests',
    'Validating assertions with TypeScript',
    'Executing in Chromium',
    'Self-correcting mechanical failures',
    'Suite generation complete',
  ];

  const currentAction = stepTitles[Math.min(active, 6)] ?? 'Processing';

  const subcopy =
    submittedUrls.length === 1
      ? submittedUrls[0]
      : `${submittedUrls.length} pages running as separate jobs`;

  const percent = Math.min(100, Math.round(((Math.min(active, 5) + 1) / steps.length) * 100));

  return (
    <section aria-labelledby="pipeline-progress-title" className="progress-panel">
      <div className="progress-top">
        <div>
          <p className="eyebrow">Agent working</p>
          <h2 id="pipeline-progress-title">Building your test suite</h2>
        </div>
        <span className="time-est">
          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
          {formatDurationMs(elapsed)} elapsed
        </span>
      </div>

      <div className="pipeline">
        {steps.map((step, i) => (
          <div
            className={`pipe-step ${i < active ? 'done' : i === active ? 'current' : ''}`}
            key={step}
          >
            <span>
              {i < active ? (
                <Check aria-hidden="true" className="h-3 w-3" />
              ) : (
                i + 1
              )}
            </span>
            <strong>{step}</strong>
            {i < steps.length - 1 && <i />}
          </div>
        ))}
      </div>

      <div className="current-work">
        <span className="spinner" />
        <div>
          <strong>{currentAction}</strong>
          <p>{subcopy}</p>
        </div>
        <span>{percent}%</span>
      </div>
    </section>
  );
}
