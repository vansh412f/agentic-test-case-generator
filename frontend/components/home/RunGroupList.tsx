import { useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { JobSummary } from '@/types/api';
import { isTerminalJobStatus } from '@/lib/utils';
import { useApiBase } from '@/hooks/useApiBase';
import { cancelJob } from '@/lib/api';
import { toast } from 'sonner';

interface RunGroupListProps {
  jobIds: string[];
  submittedUrls: string[];
  summaries: JobSummary[];
}

// Multi-page run group: jobs run sequentially server-side. Statuses come from
// one visitor-scoped list poll (not N EventSources: HTTP/1.1 caps a browser
// at 6 connections per origin, which N streams would exhaust in local dev).
export function RunGroupList({ jobIds, submittedUrls, summaries }: RunGroupListProps) {
  const [cancelling, setCancelling] = useState(false);
  const base = useApiBase();
  const completed = summaries.filter((s) => s.status === 'completed').length;
  const cancelled = summaries.filter((s) => s.status === 'cancelled').length;
  const headingText = cancelled > 0
    ? `${completed} of ${jobIds.length} jobs completed (${cancelled} cancelled)`
    : `${completed} of ${jobIds.length} jobs completed`;

  const nonTerminal = summaries.find((s) => !isTerminalJobStatus(s.status));

  const handleCancelRemaining = async () => {
    if (!nonTerminal) return;
    setCancelling(true);
    try {
      await cancelJob(nonTerminal.id, 'group');
      toast.success('Remaining jobs cancelled');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <section aria-labelledby="run-group-title" className="app-map mb-12">
      <div className="section-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p className="eyebrow">Run group</p>
          <h2 id="run-group-title">{headingText}</h2>
        </div>
        {nonTerminal && (
          <button
            type="button"
            className="secondary-button"
            style={{ fontSize: '12px', padding: '6px 12px' }}
            onClick={() => void handleCancelRemaining()}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling…' : 'Cancel remaining'}
          </button>
        )}
      </div>
      <div className="page-list">
        {jobIds.map((jobId, index) => {
          const summary = summaries.find((s) => s.id === jobId);
          return (
            <div className="group-row" key={jobId}>
              <span className="page-name min-w-0">
                <strong className="truncate block">{summary?.targetUrl ?? submittedUrls[index] ?? jobId}</strong>
                <code>
                  {summary && summary.testCount > 0
                    ? `${summary.testCount} tests · ${summary.passedCount} passed · ${summary.failedCount} findings · ${summary.gaveUpCount} gave up`
                    : summary?.status === 'cancelled'
                    ? 'Cancelled'
                    : `#${jobId.slice(0, 6)}`}
                </code>
              </span>
              <div className="group-row-actions flex items-center gap-2 sm:contents">
                <StatusBadge status={summary?.status ?? 'pending'} />
                <Link className="primary-button text-xs py-2 px-3 shrink-0" href={`/jobs/${jobId}`}>
                  Open job
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
