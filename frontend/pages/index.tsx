import { ArrowRight, CheckCircle, Warning, XCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useReducer, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Seo } from '@/components/common/Seo';
import { CrawlPreview } from '@/components/home/CrawlPreview';
import { HowItWorks } from '@/components/home/HowItWorks';
import { PipelineProgress } from '@/components/home/PipelineProgress';
import { UrlGenerateForm } from '@/components/home/UrlGenerateForm';
import { LocalTargetPanel } from '@/components/home/LocalTargetPanel';
import { StatsBar } from '@/components/home/StatsBar';
import { QuotaExhaustedPanel } from '@/components/home/QuotaExhaustedPanel';
import { PowWidget } from '@/components/home/PowWidget';
import { HeroTerminal } from '@/components/home/HeroTerminal';
import { useJobPolling } from '@/hooks/useJobPolling';
import { classifyTarget, isTunnelUrl, getDeploymentMode } from '@/lib/targetUrl';

import {
  ApiError,
  crawlPage,
  generateBatch,
  generateSingle,
  getJobs,
  hasConfiguredKeys,
  getApiMode,
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
  const [hasCustomKeys, setHasCustomKeys] = useState(false);
  const [altchaPayload, setAltchaPayload] = useState<string | null>(null);
  const [powEpoch, setPowEpoch] = useState(0);
  const [localTargetUrl, setLocalTargetUrl] = useState<string | null>(null);
  const [quotaDetails, setQuotaDetails] = useState<{ limit?: number; resetsAt?: string } | null>(null);

  useEffect(() => {
    setHasCustomKeys(hasConfiguredKeys());
  }, []);

  // Cmd/Ctrl+K shortcut to focus and select the target URL input
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const input = document.getElementById('target-url') as HTMLInputElement | null;
        if (input) {
          input.focus();
          input.select();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    const classified = classifyTarget(url);
    const mode = getDeploymentMode();
    const isLocalApi = getApiMode() === 'local-agent';

    if (
      mode === 'hosted' &&
      !isLocalApi &&
      (classified.kind === 'loopback' || classified.kind === 'private')
    ) {
      setLocalTargetUrl(url);
      return;
    }

    setLocalTargetUrl(null);
    dispatch({ type: 'CRAWL_STARTED' });

    try {
      const appMap = await crawlPage(url);
      toast.success(`App map discovered: ${appMap.elements.length} interactive elements.`);
      dispatch({ type: 'CRAWL_SUCCEEDED', appMap });
    } catch (error) {
      let msg = errorMessage(error);
      if (isTunnelUrl(url)) {
        msg +=
          ' (Tunnel URLs stop working when the cloudflared terminal is closed, and change every time you restart it. Re-run the command and paste the new URL.)';
      }
      toast.error(msg);
      dispatch({ type: 'FAILED', message: msg });
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!hasCustomKeys && !altchaPayload) {
      toast('Bot check is still running — one moment');
      return;
    }

    const urls = state.selectedUrls;
    if (urls.length === 0) return;

    const payloadToUse = altchaPayload ?? undefined;
    // Single-use semantics: clear payload and force remount on next solve
    setAltchaPayload(null);
    setPowEpoch((epoch) => epoch + 1);

    dispatch({ type: 'GENERATION_STARTED', urls });

    try {
      if (urls.length === 1) {
        const result = await generateSingle(urls[0] ?? '', payloadToUse);
        toast.success('Test suite generation completed successfully');
        await router.push(`/jobs/${result.jobId}`);
        return;
      }

      const batch = await generateBatch(urls, payloadToUse);
      toast.success(`Batch completed: ${batch.summary.succeeded}/${batch.summary.total} jobs succeeded`);
      dispatch({ type: 'BATCH_SUCCEEDED', batch });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'DAILY_QUOTA_EXHAUSTED') {
          setQuotaDetails({
            limit: error.details?.limit ?? 20,
            resetsAt: error.details?.resetsAt,
          });
          toast.error('The free daily demo quota is exhausted. Add your own API key to continue.');
        } else if (error.code === 'QUEUE_FULL') {
          toast.error('The demo server is currently running at maximum capacity. Please retry shortly.');
        } else if (error.code === 'RATE_LIMITED') {
          const wait = error.details?.retryAfterSeconds ? ` Please retry in ${error.details.retryAfterSeconds}s.` : ' Please slow down.';
          toast.error(`Rate limit reached.${wait}`);
        } else if (error.code === 'POW_FAILED') {
          toast.error('Bot verification failed. Please try again.');
        } else {
          toast.error(error.message || 'Generation failed.');
        }
      } else {
        toast.error(error instanceof Error ? error.message : 'Generation failed.');
      }
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
            name: 'Agentic Test Case Generator',
            url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
          },
          {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'Agentic Test Case Generator',
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'Web',
            description:
              'AI-powered generation, execution, and self-correction of Playwright end-to-end test suites.',
          },
        ]}
        path="/"
        title="Agentic Test Case Generator — AI-Powered E2E Testing"
      />

      <section className="hero">
        <div className="hero-copy">
          <span className="overline">
            <i /> PLAYWRIGHT TESTING, ON AUTOPILOT
          </span>

          <h1>
            Your app,
            <br />
            <em>tested by agents.</em>
          </h1>

          <p>
            Paste a URL. Get production-ready Playwright tests that crawl, run, and self-correct—without hiding real bugs.
          </p>

          <UrlGenerateForm
            busy={busy}
            busyLabel={
              state.phase === 'crawling'
                ? 'Crawling…'
                : 'Pipeline Running…'
            }
            onCrawl={handleCrawl}
          />
        </div>

        <HeroTerminal />
      </section>

      <StatsBar />

      {localTargetUrl ? (
        <LocalTargetPanel
          onDismiss={() => setLocalTargetUrl(null)}
          onTunnelUrlAccepted={(tunnelUrl) => {
            setLocalTargetUrl(null);
            void handleCrawl(tunnelUrl);
          }}
          targetUrl={localTargetUrl}
        />
      ) : null}

      {quotaDetails ? (
        <QuotaExhaustedPanel
          limit={quotaDetails.limit}
          onDismiss={() => setQuotaDetails(null)}
          resetsAt={quotaDetails.resetsAt}
        />
      ) : null}

      {state.error && !quotaDetails ? (
        <div className="error-banner mb-12" role="alert">
          <span>
            <Warning aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <strong>Request failed</strong>
            <p>{state.error}</p>
          </div>
          {state.jobId ? (
            <Link
              className="inline-flex items-center gap-1.5 font-bold"
              href={`/jobs/${state.jobId}`}
            >
              Open discovered job
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      ) : null}

      {state.appMap && state.phase !== 'submitting' ? (
        <CrawlPreview
          appMap={state.appMap}
          disabled={!hasCustomKeys && !altchaPayload}
          generating={false}
          onGenerate={() => void handleGenerate()}
          onReset={() => {
            setAltchaPayload(null);
            dispatch({ type: 'RESET' });
          }}
          onToggleUrl={(url) => dispatch({ type: 'TOGGLE_URL', url })}
          selectedUrls={state.selectedUrls}
        />
      ) : null}

      {state.phase === 'submitting' ? (
        <PipelineProgress
          job={liveJob}
          jobId={state.jobId}
          startedAt={state.startedAt}
          submittedUrls={state.submittedUrls}
        />
      ) : null}

      {state.phase === 'batch-complete' && state.batch ? (
        <section
          aria-labelledby="batch-results-title"
          className="app-map mb-12"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">Batch complete</p>
              <h2 id="batch-results-title">
                {state.batch.summary.succeeded} of {state.batch.summary.total} jobs completed
              </h2>
            </div>
          </div>

          <div className="page-list">
            {state.batch.results.map((result) => (
              <div className="page-row" key={result.url}>
                <span className="page-icon">
                  {result.status === 'completed' ? (
                    <CheckCircle aria-hidden="true" className="h-4 w-4 text-[#527318]" />
                  ) : (
                    <XCircle aria-hidden="true" className="h-4 w-4 text-danger" />
                  )}
                </span>
                <span className="page-name">
                  <strong>{result.url}</strong>
                  <code>
                    {result.status === 'completed'
                      ? `${result.testCount} tests · ${result.passedCount} passed · ${result.failedCount} findings · ${result.gaveUpCount} gave up`
                      : `${result.error.error}: ${result.error.message}`}
                  </code>
                </span>
                {result.status === 'completed' ? (
                  <Link
                    className="primary-button text-xs py-2 px-3"
                    href={`/jobs/${result.jobId}`}
                  >
                    Open job
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {state.appMap && state.phase !== 'submitting' && !hasCustomKeys ? (
        <PowWidget key={powEpoch} onPayload={setAltchaPayload} />
      ) : null}

      <HowItWorks />
    </>
  );
}
