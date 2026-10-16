import { CalendarBlank, Check, Copy, Globe, Hash, Timer } from '@phosphor-icons/react';
import { useState } from 'react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime, formatJobDuration, formatJobShortId } from '@/lib/utils';
import type { JobDetail } from '@/types/api';

interface JobStatusHeaderProps {
  job: JobDetail;
}

export function JobStatusHeader({ job }: JobStatusHeaderProps) {
  const [copied, setCopied] = useState(false);

  async function copyJobId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(job.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-caption uppercase tracking-widest text-brand-strong dark:text-brand">
            Generation job
          </p>
          <h1 className="mt-3 break-all text-heading-2 font-bold">
            Test Results for {job.targetUrl}
          </h1>
        </div>

        <StatusBadge className="shrink-0" status={job.status} />
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-panel border bg-background p-4">
          <dt className="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
            <Hash aria-hidden="true" className="h-4 w-4" />
            Job ID
          </dt>
          <dd className="mt-2 flex items-center justify-between gap-2 font-mono text-caption">
            <span className="font-bold text-foreground" title={job.id}>
              {formatJobShortId(job.id)}
            </span>
            <button
              aria-label={copied ? 'Job ID copied' : 'Copy full Job ID'}
              className="inline-flex h-7 w-7 items-center justify-center rounded-control transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
              onClick={() => void copyJobId()}
              type="button"
            >
              {copied ? (
                <Check aria-hidden="true" className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy aria-hidden="true" className="h-3.5 w-3.5" />
              )}
            </button>
          </dd>
        </div>

        <div className="rounded-panel border bg-background p-4">
          <dt className="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
            <Globe aria-hidden="true" className="h-4 w-4" />
            Target
          </dt>
          <dd className="mt-2 break-all font-mono text-caption">{job.targetUrl}</dd>
        </div>

        <div className="rounded-panel border bg-background p-4">
          <dt className="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
            <CalendarBlank aria-hidden="true" className="h-4 w-4" />
            Created
          </dt>
          <dd className="mt-2 font-mono text-caption">
            {formatDateTime(job.createdAt)}
          </dd>
        </div>

        <div className="rounded-panel border bg-background p-4">
          <dt className="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
            <Timer aria-hidden="true" className="h-4 w-4" />
            Duration
          </dt>
          <dd className="mt-2 font-mono text-caption">
            {formatJobDuration(job.startedAt, job.completedAt)}
          </dd>
        </div>
      </dl>

      {job.status === 'failed' && (job.errorCode || job.errorMessage) ? (
        <div className="mt-5 rounded-panel border border-danger/40 bg-danger/10 p-4" role="alert">
          <p className="font-mono text-small font-bold text-danger">
            {job.errorCode ?? 'PIPELINE_FAILED'}
          </p>
          <p className="mt-1 text-small">
            {job.errorMessage ?? 'No error message was recorded.'}
          </p>
        </div>
      ) : null}
    </section>
  );
}
