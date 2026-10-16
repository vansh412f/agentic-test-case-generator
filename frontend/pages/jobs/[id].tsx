import type { GetServerSideProps } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Seo } from '@/components/common/Seo';
import { AgentTimeline } from '@/components/job/AgentTimeline';
import { JobActions } from '@/components/job/JobActions';
import { JobStatusHeader } from '@/components/job/JobStatusHeader';
import { TestResultCard } from '@/components/job/TestResultCard';
import { TokenUsage } from '@/components/job/TokenUsage';
import { useJobPolling } from '@/hooks/useJobPolling';
import type { JobDetail } from '@/types/api';

interface JobPageProps {
  initialJob: JobDetail | null;
  jobId: string;
}

export const getServerSideProps: GetServerSideProps<JobPageProps> = async ({
  params,
}) => {
  const rawId = params?.id;
  const jobId = typeof rawId === 'string' ? rawId : '';

  if (jobId.length === 0) {
    return { notFound: true };
  }

  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';

  try {
    const response = await fetch(`${backendUrl}/api/jobs/${jobId}`, {
      headers: { Accept: 'application/json' },
    });

    if (response.status === 404) {
      return { notFound: true };
    }

    if (!response.ok) {
      return {
        props: {
          initialJob: null,
          jobId,
        },
      };
    }

    // Server fetch boundary for the backend's documented job contract.
    const initialJob = (await response.json()) as JobDetail;

    return {
      props: {
        initialJob,
        jobId,
      },
    };
  } catch {
    return {
      props: {
        initialJob: null,
        jobId,
      },
    };
  }
};

function JobDetailContent({ initialJob, jobId }: JobPageProps) {
  const {
    data: job,
    error,
    isLoading,
    mutate,
  } = useJobPolling(jobId, initialJob ?? undefined);

  if (job === undefined) {
    return (
      <section className="py-section-sm">
        <h1 className="text-heading-1 font-bold">Loading test results…</h1>

        {error || !isLoading ? (
          <div className="panel mt-6 max-w-reading p-6" role="alert">
            <h2 className="text-card-title font-bold">Job data is unavailable</h2>
            <p className="mt-2 text-body text-muted-foreground">
              The backend could not return this job. It may still be starting,
              or the API may be offline.
            </p>
            <button
              className="mt-5 min-h-11 rounded-control bg-brand px-5 font-semibold text-brand-foreground transition-opacity hover:opacity-90"
              onClick={() => void mutate()}
              type="button"
            >
              Retry Loading Job
            </button>
          </div>
        ) : (
          <div aria-label="Loading job details" className="mt-6 space-y-4" role="status">
            <div className="skeleton-line h-36 w-full" />
            <div className="skeleton-line h-72 w-full" />
          </div>
        )}
      </section>
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  return (
    <>
      <Seo
        description={`Playwright generation results, attempts, corrections, token usage, and confidence for ${job.targetUrl}.`}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'Home',
              item: `${siteUrl}/`,
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: 'Jobs',
              item: `${siteUrl}/jobs`,
            },
            {
              '@type': 'ListItem',
              position: 3,
              name: job.id,
              item: `${siteUrl}/jobs/${job.id}`,
            },
          ],
        }}
        path={`/jobs/${job.id}`}
        title={`Test Results for ${job.targetUrl} — Autonomous Test Suite Generator`}
      />

      <nav aria-label="Breadcrumb" className="py-6">
        <ol className="flex flex-wrap items-center gap-2 font-mono text-caption text-muted-foreground">
          <li>
            <Link className="rounded-control hover:text-foreground" href="/">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link className="rounded-control hover:text-foreground" href="/jobs">
              Jobs
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="max-w-56 truncate text-foreground">
            {job.id}
          </li>
        </ol>
      </nav>

      <JobStatusHeader job={job} />

      <div className="grid items-start gap-6 py-6 lg:grid-cols-job-detail">
        <section aria-labelledby="test-results-title" className="space-y-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-caption uppercase tracking-widest text-muted-foreground">
                Generated suite
              </p>
              <h2 className="mt-2 text-heading-2 font-bold" id="test-results-title">
                Test results
              </h2>
            </div>
            <p className="font-mono text-caption text-muted-foreground">
              {job.generatedTests.length} tests
            </p>
          </div>

          {job.generatedTests.length === 0 ? (
            <div className="panel p-6">
              <h3 className="text-card-title font-bold">
                No generated tests yet
              </h3>
              <p className="mt-2 text-body text-muted-foreground">
                Tests appear here as each test case completes generation,
                validation, and execution.
              </p>
            </div>
          ) : (
            job.generatedTests.map((test) => (
              <TestResultCard
                key={test.id}
                plannedCase={job.testPlan?.testCases.find(
                  (testCase) => testCase.id === test.testCaseId,
                )}
                test={test}
              />
            ))
          )}
        </section>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <section aria-labelledby="job-actions-title" className="panel p-5">
            <h2 className="text-card-title font-bold" id="job-actions-title">
              Deliverables
            </h2>
            <div className="mt-4">
              <JobActions job={job} />
            </div>
          </section>

          <section aria-labelledby="token-usage-title" className="panel p-5">
            <h2 className="text-card-title font-bold" id="token-usage-title">
              Token usage & cost
            </h2>
            <div className="mt-4">
              <TokenUsage costEstimate={job.costEstimate} steps={job.agentSteps} />
            </div>
          </section>

          <section aria-labelledby="agent-timeline-title" className="panel p-5">
            <h2 className="text-card-title font-bold" id="agent-timeline-title">
              Agent timeline
            </h2>
            <div className="mt-5">
              <AgentTimeline steps={job.agentSteps} />
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

export default function JobPage(props: JobPageProps) {
  const router = useRouter();

  return (
    <ErrorBoundary key={router.asPath}>
      <JobDetailContent {...props} />
    </ErrorBoundary>
  );
}
