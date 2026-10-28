import { ArrowCounterClockwise, Sparkle, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import { Seo } from '@/components/common/Seo';
import { JobsPagination } from '@/components/jobs/JobsPagination';
import { JobsTable } from '@/components/jobs/JobsTable';
import { fetcher, apiBase } from '@/lib/api';
import { isTerminalJobStatus } from '@/lib/utils';
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
        refreshInterval: (latest) => (latest?.jobs.some((j) => !isTerminalJobStatus(j.status)) ? 3000 : 0),
      },
    );

  return (
    <>
      <Seo
        description="Review previous autonomous Playwright generation jobs, outcomes, findings, corrections, and exports."
        path="/jobs"
        title="Test History — Agentic Test Case Generator"
      />

      <main className="page-main">
        <div className="page-title">
          <p className="eyebrow">RUN HISTORY</p>
          <h1>Previous generation jobs</h1>
          <p>Track every test run and inspect agent decisions.</p>
        </div>

        {isLoading && data === undefined ? (
          <div className="history-skeleton">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} />
            ))}
          </div>
        ) : error !== undefined && data === undefined ? (
          <div className="error-banner" role="alert">
            <span>
              <Warning aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              <strong>We couldn’t load your job history</strong>
              <p>The service may be temporarily unavailable. Your jobs are safe.</p>
            </div>
            <button onClick={() => void mutate()} type="button">
              <ArrowCounterClockwise aria-hidden="true" className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        ) : data === undefined || data.jobs.length === 0 ? (
          <div className="empty-state">
            <span>
              <Sparkle aria-hidden="true" className="h-7 w-7" />
            </span>
            <h2>No jobs yet</h2>
            <p>Your generated test suites will appear here once you crawl your first app.</p>
            <Link className="primary-button" href="/">
              Generate your first suite
            </Link>
          </div>
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
      </main>
    </>
  );
}
