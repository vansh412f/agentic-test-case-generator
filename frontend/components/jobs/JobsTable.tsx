import Link from 'next/link';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatJobDuration } from '@/lib/utils';
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
        <span>DURATION / COST</span>
        <span>CREATED</span>
      </div>

      {jobs.map((job) => {
        const dateObj = new Date(job.createdAt);
        const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return (
          <Link
            className="job-row table-grid"
            href={`/jobs/${job.id}`}
            key={job.id}
          >
            <span className="job-target">
              <b>#{job.id.slice(0, 8)}</b>
              <strong>{cleanDomain(job.targetUrl)}</strong>
            </span>

            <span>
              <StatusBadge status={job.status} />
            </span>

            <span>
              <b className="pass">{job.passedCount} passed</b>
              <small>
                {job.failedCount} {job.failedCount === 1 ? 'finding' : 'findings'} · {job.testCount} cases
              </small>
            </span>

            <span>
              <b>{job.gaveUpCount > 0 ? job.gaveUpCount : 0}</b>
              <small>{job.gaveUpCount > 0 ? 'retried' : 'clean'}</small>
            </span>

            <span>
              <b>{formatJobDuration(job.createdAt, job.completedAt)}</b>
              <small>standard</small>
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
