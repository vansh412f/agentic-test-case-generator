import Link from 'next/link';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatRunTiming } from '@/lib/utils';
import type { JobSummary } from '@/types/api';

interface JobsTableProps {
  jobs: JobSummary[];
}

function cleanDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname);
  } catch {
    return urlStr.replace(/^https?:\/\//, '');
  }
}

export function JobsTable({ jobs }: JobsTableProps) {
  return (
    <div className="history-card">
      <div className="table-head table-grid">
        <span>JOB / TARGET</span>
        <span>STATUS</span>
        <span>RESULTS</span>
        <span>CORRECTIONS</span>
        <span>DURATION</span>
        <span>TOKENS</span>
        <span>CREATED</span>
      </div>

      {jobs.map((job) => {
        const dateObj = new Date(job.createdAt);
        const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const { ran, waited } = formatRunTiming(job);

        return (
          <Link
            className="job-row table-grid"
            href={`/jobs/${job.id}`}
            key={job.id}
          >
            <span className="job-target">
              <b>#{job.id.slice(0, 8)}</b>
              <strong>{cleanDomain(job.targetUrl)}</strong>
              {job.tokensUsed ? (
                <small className="mobile-tokens">{job.tokensUsed.toLocaleString()} tokens</small>
              ) : null}
            </span>

            <span>
              <StatusBadge status={job.status} />
            </span>

            <span>
              {job.status === 'cancelled' && job.testCount === 0 ? (
                <>
                  <b>Cancelled</b>
                  <small>no tests run</small>
                </>
              ) : (
                <>
                  <b className="pass">{job.passedCount} passed</b>
                  <small>
                    {job.failedCount} {job.failedCount === 1 ? 'finding' : 'findings'}
                    {job.needsReviewCount && job.needsReviewCount > 0
                      ? ` · ${job.needsReviewCount} needs review`
                      : ''} · {job.testCount} cases
                  </small>
                </>
              )}
            </span>

            <span>
              <b>{job.healedCount ?? 0} / {job.gaveUpCount ?? 0}</b>
              <small>healed / gave up</small>
            </span>

            <span>
              <b>{ran}</b>
              <small>{waited ? `waited ${waited}` : ''}</small>
            </span>

            <span>
              <b>{job.tokensUsed ? job.tokensUsed.toLocaleString() : '—'}</b>
              <small>tokens</small>
            </span>

            <span>
              <b>{dateStr}</b>
              <small>{timeStr}</small>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
