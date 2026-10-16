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

      <section className="grid items-start gap-8 py-section-sm lg:grid-cols-how-desktop">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
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
        </motion.div>

        <motion.div
          animate={{ opacity: 1, scale: 1, y: 0 }}
          initial={{ opacity: 0, scale: 0.98, y: 16 }}
          transition={{ delay: 0.15, duration: 0.55, ease: 'easeOut' }}
        >
          <HeroTerminal />
        </motion.div>
      </section>

      <StatsBar />

      {quotaDetails ? (
        <QuotaExhaustedPanel
          limit={quotaDetails.limit}
          onDismiss={() => setQuotaDetails(null)}
          resetsAt={quotaDetails.resetsAt}
        />
      ) : null}

      {state.error && !quotaDetails ? (
        <div
          className="mb-8 flex gap-3 rounded-panel border border-danger/40 bg-danger/10 p-5"
          role="alert"
        >
          <Warning aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
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
        <motion.section
          animate={{ opacity: 1, y: 0 }}
          aria-labelledby="batch-results-title"
          className="panel mb-section-sm p-5 sm:p-6"
          initial={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
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
                    <CheckCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-success" />
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
        </motion.section>
      ) : null}

      {state.appMap && state.phase !== 'submitting' ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="pb-section-sm"
          initial={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
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
        </motion.div>
      ) : null}

      {state.appMap && state.phase !== 'submitting' && !hasCustomKeys ? (
        <PowWidget key={powEpoch} onPayload={setAltchaPayload} />
      ) : null}
      <HowItWorks />
    </>
  );
}
