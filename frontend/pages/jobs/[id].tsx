import type { GetServerSideProps } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  Check,
  DownloadSimple,
  Globe,
  X,
} from '@phosphor-icons/react';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Seo } from '@/components/common/Seo';
import { StatusBadge } from '@/components/common/StatusBadge';
import { TestResultCard } from '@/components/job/TestResultCard';
import { ShareButton } from '@/components/job/ShareButton';
import { ContinueTesting } from '@/components/job/ContinueTesting';
import { useJobStream } from '@/hooks/useJobStream';
import { useApiBase } from '@/hooks/useApiBase';
import { ApiError } from '@/lib/api';
import { formatJobDuration, isTerminalJobStatus } from '@/lib/utils';
import type { JobDetail } from '@/types/api';

interface JobPageProps {
  initialJob: JobDetail | null;
  jobId: string;
}

const SSR_FETCH_TIMEOUT_MS = 4_000;

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
      signal: AbortSignal.timeout(SSR_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        props: {
          initialJob: null,
          jobId,
        },
      };
    }

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

function cleanDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname);
  } catch {
    return urlStr.replace(/^https?:\/\//, '');
  }
}

function JobDetailContent({ initialJob, jobId }: JobPageProps) {
  const router = useRouter();
  const isShareView = router.query.share === '1';
  const base = useApiBase();
  const {
    data: job,
    error,
    isLoading,
    mutate,
    transport,
  } = useJobStream(jobId, initialJob ?? undefined);

  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancel = async (scope: 'job' | 'group') => {
    if (!job) return;
    setIsCancelling(true);
    try {
      await fetch(`${base}/api/jobs/${job.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      setShowCancelDialog(false);
      void mutate();
    } catch (err) {
      console.error('Cancel failed', err);
    } finally {
      setIsCancelling(false);
    }
  };

  const timelineRef = useRef<HTMLDivElement>(null);
  const userScrolledAwayRef = useRef(false);
  const stepsCount = job?.agentSteps.length ?? 0;
  const prevStepsCountRef = useRef(stepsCount);
  const isTerminal = job ? isTerminalJobStatus(job.status) : false;

  useEffect(() => {
    if (!job || isTerminal) return;
    if (stepsCount > prevStepsCountRef.current) {
      prevStepsCountRef.current = stepsCount;
      if (!userScrolledAwayRef.current && timelineRef.current) {
        timelineRef.current.scrollTo({
          left: timelineRef.current.scrollWidth,
          behavior: 'smooth',
        });
      }
    } else {
      prevStepsCountRef.current = stepsCount;
    }
  }, [job, stepsCount, isTerminal]);

  const handleTimelineScroll = () => {
    const el = timelineRef.current;
    if (!el) return;
    const distanceFromRight = el.scrollWidth - el.scrollLeft - el.clientWidth;
    userScrolledAwayRef.current = distanceFromRight > 24;
  };

  if (job === undefined) {
    const isNotFound = error instanceof ApiError && error.status === 404;

    if (isNotFound) {
      return (
        <main className="page-main">
          <div className="not-found">
            <span>
              <Globe aria-hidden="true" className="h-7 w-7" />
            </span>
            <p className="eyebrow">JOB NOT FOUND</p>
            <h1>This job lives on another backend</h1>
            <p>
              It may have been created while your local Agentic backend was running.
              Reconnect that backend and refresh, or return to your hosted job history.
            </p>
            <div className="flex justify-center gap-3">
              <Link className="secondary-button" href="/jobs">
                Back to history
              </Link>
              <button
                className="primary-button"
                onClick={() => void mutate()}
                type="button"
              >
                <ArrowCounterClockwise aria-hidden="true" className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          </div>
        </main>
      );
    }

    if (error || !isLoading) {
      return (
        <main className="page-main">
          <div className="error-banner" role="alert">
            <span>
              <Globe aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              <strong>Could not load job details</strong>
              <p>The backend could not return this job. It may still be starting, or the API may be offline.</p>
            </div>
            <button onClick={() => void mutate()} type="button">
              <ArrowCounterClockwise aria-hidden="true" className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        </main>
      );
    }

    return (
      <main className="page-main">
        <div className="history-skeleton">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} />
          ))}
        </div>
      </main>
    );
  }

  const terminal = isTerminal;

  const durationStr = formatJobDuration(job.createdAt, job.completedAt);
  const passedCount = job.generatedTests.filter(
    (t) => t.finalStatus === 'passed',
  ).length;
  const failedCount = job.generatedTests.filter(
    (t) => t.finalStatus === 'failed',
  ).length;
  const correctedCount = job.generatedTests.filter((t) =>
    t.executionResults.some((r) => r.corrected),
  ).length;

  const passRate =
    job.generatedTests.length > 0
      ? `${Math.round((passedCount / job.generatedTests.length) * 100)}%`
      : '—';

  const totalTokens =
    job.tokenUsage?.totalTokens ??
    job.agentSteps.reduce(
      (sum, s) => sum + (s.promptTokens ?? 0) + (s.completionTokens ?? 0),
      0,
    );
  const tokensStr = totalTokens > 0 ? totalTokens.toLocaleString() : '—';

  return (
    <>
      <Seo
        description={`Playwright generation results, attempts, corrections, token usage, and confidence for ${job.targetUrl}.`}
        image={`/api/og?id=${job.id}`}
        noindex
        path={`/jobs/${job.id}`}
        title={`Test Results for ${job.targetUrl} — Agentic Test Case Generator`}
      />

      <main className="page-main detail-page">
        {isShareView ? (
          <div className="share-cta">
            <p>
              <strong>Shared test run.</strong> These Playwright tests were
              generated, executed and self-corrected by an AI agent from a single URL.
            </p>
            <Link className="primary-button" href="/">
              Generate tests for your app
            </Link>
          </div>
        ) : (
          <Link className="back-link" href="/jobs">
            ← All jobs
          </Link>
        )}

        <section className="job-hero">
          <div>
            <div className="job-title-line">
              <StatusBadge status={job.status} />
              {job.status === 'pending' && typeof job.queuePosition === 'number' && job.queuePosition > 0 && (
                <span className="queue-pill" style={{ color: '#0369a1', background: '#e0f2fe', borderRadius: '20px', padding: '3px 8px', fontSize: '10px', fontWeight: 600 }}>
                  Waiting in line · #{job.queuePosition}
                </span>
              )}
              <span>#{job.id.slice(0, 8)}</span>
              {job.usedOwnKeys && (
                <span className="byok-pill" style={{ color: '#4d6919', background: '#edf8db', borderRadius: '20px', padding: '3px 8px', fontSize: '10px', fontWeight: 600 }}>
                  Ran on your API keys
                </span>
              )}
              {!terminal && transport !== 'idle' && (
                <span className={`live-pill ${transport === 'sse' ? 'is-live' : ''}`}>
                  <i aria-hidden="true" />
                  {transport === 'sse' ? 'Live' : 'Polling'}
                </span>
              )}
            </div>
            <h1>{cleanDomain(job.targetUrl)}</h1>
            <a href={job.targetUrl} rel="noreferrer" target="_blank">
              {job.targetUrl} <ArrowSquareOut aria-hidden="true" className="h-3 w-3" />
            </a>
          </div>

          <div className="job-actions">
            {terminal && !isShareView && (
              <ShareButton jobId={job.id} targetUrl={job.targetUrl} />
            )}

            {terminal ? (
              <a
                className="secondary-button"
                href={`${base}/api/jobs/${job.id}/report.html`}
                rel="noreferrer"
                target="_blank"
              >
                <DownloadSimple aria-hidden="true" className="h-4 w-4" /> Download Report
              </a>
            ) : null}

            {job.generatedTests.length > 0 ? (
              <a
                className="primary-button"
                download
                href={`${base}/api/jobs/${job.id}/export.zip`}
              >
                <DownloadSimple aria-hidden="true" className="h-4 w-4" /> Export Playwright Project (.zip)
              </a>
            ) : null}

            {job.canCancel && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  if (job.groupRemainingJobs && job.groupRemainingJobs > 0) {
                    setShowCancelDialog(true);
                  } else {
                    void handleCancel('job');
                  }
                }}
                disabled={isCancelling}
              >
                {isCancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
          </div>
        </section>

        {job.status === 'cancelled' && (
          <div
            className="error-banner mb-6"
            style={{ background: '#f3f4f6', borderColor: '#d1d5db', color: '#374151', margin: '16px 0' }}
            role="status"
          >
            <div>
              <strong>Run cancelled</strong>
              <p style={{ color: '#4b5563' }}>This job was cancelled. Showing partial results.</p>
            </div>
          </div>
        )}

        {showCancelDialog && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: '16px',
            }}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: '8px',
                padding: '24px',
                maxWidth: '420px',
                width: '100%',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
              }}
            >
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 8px' }}>Cancel run</h3>
              <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 20px' }}>
                This job is part of a run group with {job.groupRemainingJobs} remaining{' '}
                {job.groupRemainingJobs === 1 ? 'job' : 'jobs'}. What would you like to cancel?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void handleCancel('job')}
                  disabled={isCancelling}
                >
                  Cancel this job
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void handleCancel('group')}
                  disabled={isCancelling}
                  style={{ borderColor: '#ef4444', color: '#b91c1c' }}
                >
                  Cancel this and the {job.groupRemainingJobs} remaining
                </button>
                <button
                  type="button"
                  onClick={() => setShowCancelDialog(false)}
                  disabled={isCancelling}
                  style={{
                    marginTop: '8px',
                    background: 'none',
                    border: 'none',
                    fontSize: '13px',
                    color: '#6b7280',
                    cursor: 'pointer',
                  }}
                >
                  Never mind, keep running
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="summary-grid">
          <div>
            <strong>{passRate}</strong>
            <span>PASS RATE</span>
          </div>
          <div>
            <strong>{durationStr}</strong>
            <span>DURATION</span>
          </div>
          <div>
            <strong>{tokensStr}</strong>
            <span>TOKENS</span>
          </div>
        </div>

        {job.agentSteps.length > 0 ? (
          <section className="detail-section">
            <div className="detail-heading">
              <div>
                <p className="eyebrow">AGENT TRACE</p>
                <h2>Execution timeline</h2>
              </div>
              <span>
                {job.agentSteps.length} steps · {durationStr} total
              </span>
            </div>

            <div className="timeline" onScroll={handleTimelineScroll} ref={timelineRef}>
              {job.agentSteps.map((step, i) => {
                const isFailed = (step as { success?: boolean }).success === false || step.status === 'failure';
                const isCorrected = step.stepType === 'correct';
                const duration = step.latencyMs
                  ? `${Math.round(step.latencyMs / 1000)}s`
                  : '—';
                const tokens = (
                  (step.promptTokens ?? 0) + (step.completionTokens ?? 0)
                ).toLocaleString();
                const hasLlm = Boolean(step.llmModel);

                return (
                  <div key={step.id || i}>
                    <span className={isFailed ? 'failed' : isCorrected ? 'corrected' : ''}>
                      {isFailed ? (
                        <X aria-hidden="true" className="h-3 w-3" />
                      ) : isCorrected ? (
                        <ArrowCounterClockwise aria-hidden="true" className="h-3 w-3" />
                      ) : (
                        <Check aria-hidden="true" className="h-3 w-3" />
                      )}
                    </span>
                    <strong>
                      {step.stepType.charAt(0).toUpperCase() + step.stepType.slice(1)}
                    </strong>
                    <small>
                      {step.testCaseId && (
                        <>
                          <span>{step.testCaseId}</span>
                          <br />
                        </>
                      )}
                      {duration}
                      <br />
                      {hasLlm ? `${tokens} tokens` : 'no LLM'}
                    </small>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="detail-section cases">
          <div className="detail-heading">
            <div>
              <p className="eyebrow">GENERATED TESTS</p>
              <h2>{job.generatedTests.length} test cases</h2>
            </div>
            <div className="result-pills">
              <span>{passedCount} passed</span>
              <span>
                {failedCount} {failedCount === 1 ? 'finding' : 'findings'}
              </span>
              <span>{correctedCount} corrected</span>
            </div>
          </div>

          {job.generatedTests.some((t) => t.finalCode.includes('__AGT_SECRET_')) && (
            <p style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
              Secret values were injected at run time and are not stored.
            </p>
          )}

          {job.generatedTests.length === 0 ? (
            <p className="mt-6 text-small text-muted-foreground">
              Tests will appear here as each test case completes generation and execution.
            </p>
          ) : (
            (() => {
              const aiTests = job.generatedTests.filter(
                (t) =>
                  !t.testCaseId.startsWith('smoke-') &&
                  job.testPlan?.testCases.find((tc) => tc.id === t.testCaseId)?.origin !== 'baseline',
              );
              const baselineTests = job.generatedTests.filter(
                (t) =>
                  t.testCaseId.startsWith('smoke-') ||
                  job.testPlan?.testCases.find((tc) => tc.id === t.testCaseId)?.origin === 'baseline',
              );
              return [...aiTests, ...baselineTests].map((test) => (
                <TestResultCard
                  key={test.id}
                  plannedCase={job.testPlan?.testCases.find(
                    (testCase) => testCase.id === test.testCaseId,
                  )}
                  test={test}
                />
              ));
            })()
          )}
        </section>

        {terminal && !isShareView && job.appMap ? (
          <ContinueTesting job={job} />
        ) : null}
      </main>
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
