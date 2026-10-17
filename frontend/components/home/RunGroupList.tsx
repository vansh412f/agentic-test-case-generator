import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { JobSummary } from '@/types/api';

interface RunGroupListProps {
  jobIds: string[];
  submittedUrls: string[];
  summaries: JobSummary[];
}

// Multi-page run group: jobs run sequentially server-side. Statuses come from
// one visitor-scoped list poll (not N EventSources: HTTP/1.1 caps a browser
// at 6 connections per origin, which N streams would exhaust in local dev).
export function RunGroupList({ jobIds, submittedUrls, summaries }: RunGroupListProps) {
  return (
    <section aria-labelledby="run-group-title" className="app-map mb-12">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Run group</p>
          <h2 id="run-group-title">
            {summaries.filter((s) => s.status === 'completed').length} of {jobIds.length} jobs completed
          </h2>
        </div>
      </div>
      <div className="page-list">
        {jobIds.map((jobId, index) => {
          const summary = summaries.find((s) => s.id === jobId);
          return (
            <div className="page-row" key={jobId}>
              <span className="page-name">
                <strong>{summary?.targetUrl ?? submittedUrls[index] ?? jobId}</strong>
                <code>
                  {summary && summary.testCount > 0
                    ? `${summary.testCount} tests · ${summary.passedCount} passed · ${summary.failedCount} findings · ${summary.gaveUpCount} gave up`
                    : `#${jobId.slice(0, 6)}`}
                </code>
              </span>
              <StatusBadge status={summary?.status ?? 'pending'} />
              <Link className="primary-button text-xs py-2 px-3" href={`/jobs/${jobId}`}>
                Open job
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
