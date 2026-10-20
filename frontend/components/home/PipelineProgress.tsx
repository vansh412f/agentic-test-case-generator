import { Check, Clock } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { formatDurationMs } from '@/lib/utils';
import type { JobDetail, JobStatus } from '@/types/api';
import type { JobTransport } from '@/hooks/useJobStream';

interface PipelineProgressProps {
  job: JobDetail | undefined;
  jobId: string | null;
  startedAt: number | null;
  submittedUrls: string[];
  liveStatus?: JobStatus | null;
  transport?: JobTransport;
}

import { computePipelineProgress, PIPELINE_STEPS } from '@/lib/pipelineProgress';

export function PipelineProgress({
  job,
  startedAt,
  submittedUrls,
  liveStatus,
  transport = 'idle',
}: PipelineProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);
  const { activeIndex: active, percent, isQueued, queuePosition, actionTitle: currentAction } =
    computePipelineProgress(job, liveStatus);

  const subcopy =
    submittedUrls.length === 1
      ? submittedUrls[0]
      : `${submittedUrls.length} pages running as separate jobs`;

  return (
    <section aria-labelledby="pipeline-progress-title" className="progress-panel">
      <div className="progress-top">
        <div>
          <p className="eyebrow">
            {isQueued
              ? queuePosition
                ? `Waiting in line · #${queuePosition}`
                : 'Waiting in line'
              : 'Agent working'}
          </p>
          <h2 id="pipeline-progress-title">Building your test suite</h2>
        </div>
        <span className="time-est">
          {transport !== 'idle' && (
            <span className={`live-pill ${transport === 'sse' ? 'is-live' : ''}`}>
              <i aria-hidden="true" />
              {transport === 'sse' ? 'Live' : 'Polling'}
            </span>
          )}
          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
          {formatDurationMs(elapsed)} elapsed
        </span>
      </div>

      <div className="pipeline">
        {PIPELINE_STEPS.map((step, i) => (
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
            {i < PIPELINE_STEPS.length - 1 && <i />}
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
