import { useState } from 'react';
import useSWR from 'swr';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { Seo } from '@/components/common/Seo';
import { JobsListSkeleton } from '@/components/common/Skeletons';
import { JobsPagination } from '@/components/jobs/JobsPagination';
import { JobsTable } from '@/components/jobs/JobsTable';
import { fetcher, apiBase } from '@/lib/api';
import type { JobsListResponse } from '@/types/api';

const PAGE_SIZE = 20;

export default function JobsPage() {
  const [page, setPage] = useState(1);

  const { data, error, isLoading, isValidating, mutate } =
    useSWR<JobsListResponse, Error>(
      `${apiBase()}/api/jobs?page=${page}&limit=${PAGE_SIZE}`,
      fetcher,
      {
        keepPreviousData: true,
      },
    );

  return (
    <>
      <Seo
        description="Review previous autonomous Playwright generation jobs, outcomes, findings, corrections, and exports."
        path="/jobs"
        title="Test History — Agentic Test Case Generator"
      />

      <section className="py-section-sm">
        <p className="font-mono text-caption uppercase tracking-widest text-brand-strong dark:text-brand">
          Generation history
        </p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-heading-1 font-bold">Test History</h1>
            <p className="mt-3 max-w-reading text-body text-muted-foreground">
              Every crawl, generated suite, correction attempt, and real
              application finding — preserved as a job.
            </p>
          </div>

          {data ? (
            <p aria-live="polite" className="font-mono text-caption text-muted-foreground">
              {data.total} jobs · page {data.page} of {Math.max(1, data.totalPages)}
            </p>
          ) : null}
        </div>

        <div className="mt-8">
          {isLoading && data === undefined ? (
            <JobsListSkeleton />
          ) : error !== undefined && data === undefined ? (
            <ErrorState
              description="The backend did not return the job history. Check that the API is running, then retry."
              onRetry={() => void mutate()}
              title="Could not load test history"
            />
          ) : data === undefined || data.jobs.length === 0 ? (
            <EmptyState
              actionHref="/"
              actionLabel="Generate Your First Test Suite"
              description="No generation jobs have been recorded yet. Crawl a localhost or staging application to create the first suite."
              title="No test jobs yet"
            />
          ) : (
            <>
              <div aria-busy={isValidating}>
                <JobsTable jobs={data.jobs} />
              </div>

              <JobsPagination
                disabled={isValidating}
                onPageChange={setPage}
                page={data.page}
                totalPages={data.totalPages}
              />
            </>
          )}
        </div>
      </section>
    </>
  );
}
