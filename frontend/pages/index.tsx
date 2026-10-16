import { AlertTriangle, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useReducer } from 'react';
import { Seo } from '@/components/common/Seo';
import { CrawlPreview } from '@/components/home/CrawlPreview';
import { HowItWorks } from '@/components/home/HowItWorks';
import { PipelineProgress } from '@/components/home/PipelineProgress';
import { UrlGenerateForm } from '@/components/home/UrlGenerateForm';
import { useJobPolling } from '@/hooks/useJobPolling';
import {
  ApiError,
  crawlPage,
  generateBatch,
  generateSingle,
  getJobs,
} from '@/lib/api';
import type { AppMap, BatchResponse } from '@/types/api';

type RunPhase =
  | 'idle'
  | 'crawling'
  | 'selecting'
  | 'submitting'
  | 'batch-complete'
  | 'error';

interface HomeState {
  phase: RunPhase;
  appMap: AppMap | null;
  selectedUrls: string[];
  submittedUrls: string[];
  jobId: string | null;
  batch: BatchResponse | null;
  error: string | null;
  startedAt: number | null;
}

type HomeAction =
  | { type: 'CRAWL_STARTED' }
  | { type: 'CRAWL_SUCCEEDED'; appMap: AppMap }
  | { type: 'TOGGLE_URL'; url: string }
  | { type: 'GENERATION_STARTED'; urls: string[] }
  | { type: 'JOB_DISCOVERED'; jobId: string }
  | { type: 'BATCH_SUCCEEDED'; batch: BatchResponse }
  | { type: 'FAILED'; message: string }
  | { type: 'RESET' };

const initialState: HomeState = {
  phase: 'idle',
  appMap: null,
  selectedUrls: [],
  submittedUrls: [],
  jobId: null,
  batch: null,
  error: null,
  startedAt: null,
};

function reducer(state: HomeState, action: HomeAction): HomeState {
  switch (action.type) {
    case 'CRAWL_STARTED':
      return {
        ...initialState,
        phase: 'crawling',
      };

    case 'CRAWL_SUCCEEDED':
      return {
        ...state,
        phase: 'selecting',
        appMap: action.appMap,
        selectedUrls: [action.appMap.url],
        error: null,
      };

    case 'TOGGLE_URL': {
      if (state.selectedUrls.includes(action.url)) {
        return {
          ...state,
          selectedUrls: state.selectedUrls.filter((url) => url !== action.url),
        };
      }

      if (state.selectedUrls.length >= 5) return state;

      return {
        ...state,
        selectedUrls: [...state.selectedUrls, action.url],
      };
    }

    case 'GENERATION_STARTED':
      return {
        ...state,
        phase: 'submitting',
        submittedUrls: action.urls,
        startedAt: Date.now(),
        jobId: null,
        error: null,
      };

    case 'JOB_DISCOVERED':
      return {
        ...state,
        jobId: action.jobId,
      };

    case 'BATCH_SUCCEEDED':
      return {
        ...state,
        phase: 'batch-complete',
        batch: action.batch,
      };

    case 'FAILED':
      return {
        ...state,
        phase: 'error',
        error: action.message,
      };

    case 'RESET':
      return initialState;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.code}: ${error.message}`;
  }

  return error instanceof Error ? error.message : 'The request failed unexpectedly.';
}

export default function HomePage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initialState);
  const { data: liveJob } = useJobPolling(state.jobId);

  const busy =
    state.phase === 'crawling' ||
    state.phase === 'submitting';

  useEffect(() => {
    if (
      state.phase !== 'submitting' ||
      state.jobId !== null ||
      state.startedAt === null
    ) {
      return;
    }

    let cancelled = false;

    async function discoverJob(): Promise<void> {
      try {
        const result = await getJobs(1, 5);
        const startedAt = state.startedAt;
        if (cancelled || startedAt === null) return;

        const candidate = result.jobs.find(
          (job) =>
            state.submittedUrls.includes(job.targetUrl) &&
            new Date(job.createdAt).getTime() >= startedAt - 5000,
        );

        if (candidate !== undefined) {
          dispatch({ type: 'JOB_DISCOVERED', jobId: candidate.id });
        }
      } catch {
        // The generation POST remains authoritative; discovery is best effort.
      }
    }

    void discoverJob();
    const interval = window.setInterval(() => void discoverJob(), 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [state.phase, state.jobId, state.startedAt, state.submittedUrls]);

  async function handleCrawl(url: string): Promise<void> {
    dispatch({ type: 'CRAWL_STARTED' });

    try {
      const appMap = await crawlPage(url);
      dispatch({ type: 'CRAWL_SUCCEEDED', appMap });
    } catch (error) {
      dispatch({ type: 'FAILED', message: errorMessage(error) });
    }
  }

  async function handleGenerate(): Promise<void> {
    const urls = state.selectedUrls;
    if (urls.length === 0) return;

    dispatch({ type: 'GENERATION_STARTED', urls });

    try {
      if (urls.length === 1) {
        const result = await generateSingle(urls[0] ?? '');
        await router.push(`/jobs/${result.jobId}`);
        return;
      }

      const batch = await generateBatch(urls);
      dispatch({ type: 'BATCH_SUCCEEDED', batch });
    } catch (error) {
      dispatch({ type: 'FAILED', message: errorMessage(error) });
    }
  }

  return (
    <>
      <Seo
        description="Generate, execute, and self-correct Playwright test suites from a web application URL."
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Autonomous Test Suite Generator',
            url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
          },
          {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'Autonomous Test Suite Generator',
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'Web',
            description:
              'AI-powered generation, execution, and self-correction of Playwright end-to-end test suites.',
          },
        ]}
        path="/"
        title="Autonomous Test Suite Generator — AI-Powered E2E Testing"
      />

      <section className="grid items-start gap-8 py-section-sm lg:grid-cols-how-desktop">
        <div>
          <p className="font-mono text-caption uppercase tracking-widest text-brand-strong dark:text-brand">
            Localhost and staging environments
          </p>

          <h1 className="mt-5 max-w-reading text-display font-bold text-balance">
            Turn a running app into a tested app.
          </h1>

          <p className="mt-6 max-w-reading text-body text-muted-foreground">
            Paste the URL of your application. An agent crawls the real UI,
            plans valuable user journeys, generates Playwright specs,
            executes them, and corrects mechanical failures without hiding
            real bugs.
          </p>

          <div className="mt-8">
            <UrlGenerateForm
              busy={busy}
              busyLabel={
                state.phase === 'crawling'
                  ? 'Crawling Application…'
                  : 'Pipeline Running…'
              }
              onCrawl={handleCrawl}
            />
          </div>
        </div>

        <aside
          aria-label="Example agent output"
          className="panel overflow-hidden font-mono text-small"
        >
          <div className="flex items-center justify-between border-b px-5 py-3">
            <span className="text-muted-foreground">agent.session</span>
            <span className="inline-flex items-center gap-2 text-success">
              <span aria-hidden="true" className="h-2 w-2 animate-blink rounded-full bg-current" />
              ready
            </span>
          </div>

          <div className="space-y-4 p-5 leading-relaxed">
            <p>
              <span className="text-muted-foreground">$ crawl</span>{' '}
              https://todo-app-staging.vercel.app
            </p>
            <p className="text-success">
              App Map: 18 elements · 1 form · 3 internal pages
            </p>
            <p>
              <span className="text-info">tc-1</span> Add new todo item
            </p>
            <p className="break-all text-muted-foreground">
              page.getByPlaceholder(&apos;What needs to be done?&apos;)
            </p>
            <p>
              <span className="text-success">PASS</span> validate · execute
            </p>
            <p>
              <span className="text-warning">CORRECTED</span> locator timeout
              on getByTestId(&apos;submit-btn&apos;)
            </p>
          </div>
        </aside>
      </section>

      {state.error ? (
        <div
          className="mb-8 flex gap-3 rounded-panel border border-danger/40 bg-danger/10 p-5"
          role="alert"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div>
            <h2 className="font-bold text-danger">Request failed</h2>
            <p className="mt-1 text-small">{state.error}</p>
            {state.jobId ? (
              <Link
                className="mt-3 inline-flex items-center gap-2 font-semibold underline"
                href={`/jobs/${state.jobId}`}
              >
                Open the discovered job
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.phase === 'submitting' ? (
        <div className="pb-section-sm">
          <PipelineProgress
            job={liveJob}
            jobId={state.jobId}
            startedAt={state.startedAt}
            submittedUrls={state.submittedUrls}
          />
        </div>
      ) : null}

      {state.phase === 'batch-complete' && state.batch ? (
        <section aria-labelledby="batch-results-title" className="panel mb-section-sm p-5 sm:p-6">
          <p className="font-mono text-caption uppercase tracking-widest text-brand-strong dark:text-brand">
            Batch complete
          </p>
          <h2 className="mt-2 text-heading-2 font-bold" id="batch-results-title">
            {state.batch.summary.succeeded} of {state.batch.summary.total} jobs completed
          </h2>

          <div className="mt-6 divide-y">
            {state.batch.results.map((result) => (
              <div
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                key={result.url}
              >
                <div className="flex min-w-0 items-start gap-3">
                  {result.status === 'completed' ? (
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  ) : (
                    <XCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
                  )}
                  <div className="min-w-0">
                    <p className="break-all font-mono text-small">{result.url}</p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {result.status === 'completed'
                        ? `${result.testCount} tests · ${result.passedCount} passed · ${result.failedCount} findings · ${result.gaveUpCount} gave up`
                        : `${result.error.error}: ${result.error.message}`}
                    </p>
                  </div>
                </div>

                {result.status === 'completed' ? (
                  <Link
                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control border px-4 font-semibold transition-colors hover:bg-muted"
                    href={`/jobs/${result.jobId}`}
                  >
                    Open job
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {state.appMap && state.phase !== 'submitting' ? (
        <div className="pb-section-sm">
          <CrawlPreview
            appMap={state.appMap}
            generating={false}
            onGenerate={() => void handleGenerate()}
            onReset={() => dispatch({ type: 'RESET' })}
            onToggleUrl={(url) => dispatch({ type: 'TOGGLE_URL', url })}
            selectedUrls={state.selectedUrls}
          />
        </div>
      ) : null}

      <HowItWorks />
    </>
  );
}
