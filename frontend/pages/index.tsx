import { ArrowRight, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useReducer, useRef, useState } from 'react';
import useSWR from 'swr';
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
import { RunGroupList } from '@/components/home/RunGroupList';
import { useJobStream } from '@/hooks/useJobStream';
import { isTerminalJobStatus } from '@/lib/utils';
import { classifyTarget, isTunnelUrl, getDeploymentMode } from '@/lib/targetUrl';
import { SITE_URL } from '@/lib/site';

import {
  ApiError,
  crawlPage,
  errorDetail,
  fetcher,
  startGeneration,
  hasConfiguredKeys,
  getApiMode,
} from '@/lib/api';
import type { AppMap, JobsListResponse } from '@/types/api';

type RunPhase =
  | 'idle'
  | 'crawling'
  | 'selecting'
  | 'submitting'
  | 'running'
  | 'error';

interface HomeState {
  phase: RunPhase;
  appMap: AppMap | null;
  selectedUrls: string[];
  submittedUrls: string[];
  jobIds: string[];
  error: string | null;
  startedAt: number | null;
  deepCrawl: boolean;
}

type HomeAction =
  | { type: 'CRAWL_STARTED' }
  | { type: 'CRAWL_SUCCEEDED'; appMap: AppMap }
  | { type: 'TOGGLE_URL'; url: string }
  | { type: 'SET_DEEP_CRAWL'; enabled: boolean }
  | { type: 'GENERATION_STARTED'; urls: string[] }
  | { type: 'JOBS_ACCEPTED'; jobIds: string[] }
  | { type: 'FAILED'; message: string }
  | { type: 'RESET' };

const initialState: HomeState = {
  phase: 'idle',
  appMap: null,
  selectedUrls: [],
  submittedUrls: [],
  jobIds: [],
  error: null,
  startedAt: null,
  deepCrawl: false,
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
        deepCrawl: false,
        error: null,
      };

    case 'TOGGLE_URL': {
      if (state.selectedUrls.includes(action.url)) {
        return {
          ...state,
          selectedUrls: state.selectedUrls.filter((url) => url !== action.url),
          deepCrawl: false,
        };
      }

      if (state.selectedUrls.length >= 5) return state;

      return {
        ...state,
        selectedUrls: [...state.selectedUrls, action.url],
        deepCrawl: false,
      };
    }

    case 'SET_DEEP_CRAWL': {
      if (state.selectedUrls.length > 1) return state;
      return {
        ...state,
        deepCrawl: action.enabled,
      };
    }

    case 'GENERATION_STARTED':
      return {
        ...state,
        phase: 'submitting',
        submittedUrls: action.urls,
        startedAt: Date.now(),
        jobIds: [],
        error: null,
      };

    case 'JOBS_ACCEPTED':
      return {
        ...state,
        phase: 'running',
        jobIds: action.jobIds,
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
  const isRunGroup = state.jobIds.length > 1;
  const { data: groupList } = useSWR<JobsListResponse, Error>(
    state.phase === 'running' && isRunGroup ? '/api/jobs?page=1&limit=20' : null,
    fetcher,
    {
      refreshInterval: (latest) =>
        latest !== undefined &&
        state.jobIds.every((id) => {
          const summary = latest.jobs.find((job) => job.id === id);
          return summary !== undefined && isTerminalJobStatus(summary.status);
        })
          ? 0
          : 3000,
    },
  );
  const groupSummaries = (groupList?.jobs ?? []).filter((job) => state.jobIds.includes(job.id));
  // Jobs in a run group execute sequentially: the active one is the first non-terminal id.
  const activeJobId =
    state.phase !== 'running'
      ? null
      : state.jobIds.find((id) => {
          const summary = groupSummaries.find((job) => job.id === id);
          return summary === undefined || !isTerminalJobStatus(summary.status);
        }) ?? null;
  const { data: liveJob, liveStatus, transport } = useJobStream(activeJobId);
  const navigatedRef = useRef<string | null>(null);
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

  const groupRunning = state.phase === 'running' && activeJobId !== null;
  const busy = state.phase === 'crawling' || state.phase === 'submitting' || groupRunning;

  // Single-job run: navigate to the job page once the stream reports a terminal status.
  useEffect(() => {
    if (state.phase !== 'running' || state.jobIds.length !== 1 || liveJob === undefined) return;
    if (liveJob.id !== state.jobIds[0] || !isTerminalJobStatus(liveJob.status)) return;
    if (navigatedRef.current === liveJob.id) return;
    navigatedRef.current = liveJob.id;
    if (liveJob.status === 'completed') {
      toast.success('Test suite generation completed successfully');
    } else {
      toast.error(`Generation failed${liveJob.errorCode ? ` (${liveJob.errorCode})` : ''}`);
    }
    void router.push(`/jobs/${liveJob.id}`);
  }, [liveJob, state.phase, state.jobIds, router]);

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
      if (error instanceof ApiError) {
        if (
          error.code === 'UPSTREAM_UNAVAILABLE' ||
          error.code === 'BROWSER_LAUNCH_FAILED' ||
          error.code === 'CRAWL_FAILED'
        ) {
          toast.error(error.message);
          dispatch({ type: 'FAILED', message: error.message });
          return;
        }
      }
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
      const { jobIds } = await startGeneration(urls, payloadToUse, {
        deepCrawl: state.deepCrawl,
      });
      dispatch({ type: 'JOBS_ACCEPTED', jobIds });
      if (jobIds.length > 1) {
        toast.success(`${jobIds.length} jobs queued. They run one after another.`);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429 || error.code === 'RATE_LIMITED') {
          const retryAfter = errorDetail(error, 'retryAfterSeconds');
          const wait =
            retryAfter !== undefined
              ? ` Please retry in ${retryAfter}s.`
              : ' Please slow down.';
          toast.error(`Rate limit reached.${wait}`);
          dispatch({ type: 'FAILED', message: errorMessage(error) });
          return;
        }

        if (error.code === 'DAILY_QUOTA_EXHAUSTED') {
          const limit = errorDetail(error, 'limit');
          const resetsAt = errorDetail(error, 'resetsAt');
          setQuotaDetails({
            limit: typeof limit === 'number' ? limit : 20,
            resetsAt: typeof resetsAt === 'string' ? resetsAt : undefined,
          });
          toast.error('The free daily demo quota is exhausted. Add your own API key to continue.');
        } else if (error.code === 'QUEUE_FULL') {
          toast.error('The demo server is currently running at maximum capacity. Please retry shortly.');
        } else if (error.code === 'POW_FAILED') {
          toast.error('Bot verification failed. Please try again.');
        } else if (
          error.code === 'UPSTREAM_UNAVAILABLE' ||
          error.code === 'BROWSER_LAUNCH_FAILED' ||
          error.code === 'CRAWL_FAILED'
        ) {
          toast.error(error.message);
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
            url: SITE_URL,
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
          {state.jobIds[0] ? (
            <Link
              className="inline-flex items-center gap-1.5 font-bold"
              href={`/jobs/${state.jobIds[0]}`}
            >
              Open job
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      ) : null}

      {state.appMap && state.phase !== 'submitting' && !groupRunning ? (
        <CrawlPreview
          appMap={state.appMap}
          deepCrawl={state.deepCrawl}
          disabled={!hasCustomKeys && !altchaPayload}
          generating={false}
          onGenerate={() => void handleGenerate()}
          onReset={() => {
            setAltchaPayload(null);
            dispatch({ type: 'RESET' });
          }}
          onToggleDeepCrawl={(v) => dispatch({ type: 'SET_DEEP_CRAWL', enabled: v })}
          onToggleUrl={(url) => dispatch({ type: 'TOGGLE_URL', url })}
          selectedUrls={state.selectedUrls}
        />
      ) : null}

      {state.phase === 'submitting' || groupRunning ? (
        <PipelineProgress
          job={liveJob}
          jobId={activeJobId}
          liveStatus={liveStatus}
          startedAt={state.startedAt}
          submittedUrls={state.submittedUrls}
          transport={transport}
        />
      ) : null}

      {state.phase === 'running' && isRunGroup ? (
        <RunGroupList
          jobIds={state.jobIds}
          submittedUrls={state.submittedUrls}
          summaries={groupSummaries}
        />
      ) : null}

      {state.appMap && state.phase !== 'submitting' && !groupRunning && !hasCustomKeys ? (
        <PowWidget key={powEpoch} onPayload={setAltchaPayload} />
      ) : null}

      <HowItWorks />
    </>
  );
}
