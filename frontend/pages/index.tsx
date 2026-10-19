import { ArrowRight, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useReducer, useRef, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Seo } from '@/components/common/Seo';
import { ErrorNotice } from '@/components/common/ErrorNotice';
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
import { useBackendMode } from '@/hooks/useBackendMode';
import { isTerminalJobStatus } from '@/lib/utils';
import { classifyTarget, isTunnelUrl, getDeploymentMode } from '@/lib/targetUrl';
import { SITE_URL } from '@/lib/site';
import { handleGenerationError } from '@/lib/generationErrors';
import { presentError } from '@/lib/errorPresentation';

import {
  apiBase,
  ApiError,
  crawlPage,
  errorDetail,
  fetcher,
  startGeneration,
  hasConfiguredKeys,
  getApiMode,
  type TestDataParam,
  type BudgetResponse,
  getBudget,
} from '@/lib/api';
import { loadRememberedTestData } from '@/lib/rememberedTestData';
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
  testData: Record<string, { value: string; sensitive: boolean }>;
}

type HomeAction =
  | { type: 'CRAWL_STARTED' }
  | {
      type: 'CRAWL_SUCCEEDED';
      appMap: AppMap;
      prefillTestData?: Record<string, { value: string; sensitive: boolean }>;
    }
  | { type: 'TOGGLE_URL'; url: string }
  | { type: 'SET_DEEP_CRAWL'; enabled: boolean }
  | { type: 'SET_TEST_DATA'; elementId: string; value: string; sensitive: boolean }
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
  testData: {},
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
        testData: action.prefillTestData ?? {},
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

    case 'SET_TEST_DATA': {
      return {
        ...state,
        testData: {
          ...state.testData,
          [action.elementId]: {
            value: action.value,
            sensitive: action.sensitive,
          },
        },
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
  const { isLocal } = useBackendMode();
  const [state, dispatch] = useReducer(reducer, initialState);
  const isRunGroup = state.jobIds.length > 1;
  const { data: groupList } = useSWR<JobsListResponse, Error>(
    state.phase === 'running' && isRunGroup ? `${apiBase()}/api/jobs?page=1&limit=20` : null,
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
  const [quotaDetails, setQuotaDetails] = useState<{ limit?: number; resetsAt?: string; scope?: string } | null>(null);
  const [isFresh, setIsFresh] = useState(false);
  const [queryUrl, setQueryUrl] = useState<string | undefined>(undefined);
  const autoCrawlDoneRef = useRef(false);

  interface WakingCrawlState {
    url: string;
    host: string;
    attempt: number;
    secondsLeft: number;
    stillAsleep: boolean;
  }

  const [wakingCrawl, setWakingCrawl] = useState<WakingCrawlState | null>(null);

  const retryCrawl = async (url: string, attempt: number) => {
    setWakingCrawl((prev) => (prev ? { ...prev, attempt, secondsLeft: 30 } : null));
    try {
      const appMap = await crawlPage(url);
      setWakingCrawl(null);
      const prefillTestData = loadRememberedTestData(url, appMap.elements);
      const prefillCount = Object.keys(prefillTestData).length;
      if (prefillCount > 0) {
        toast.success(`App map discovered: ${appMap.elements.length} elements (prefilled ${prefillCount} remembered field${prefillCount === 1 ? '' : 's'}).`);
      } else {
        toast.success(`App map discovered: ${appMap.elements.length} interactive elements.`);
      }
      dispatch({ type: 'CRAWL_SUCCEEDED', appMap, prefillTestData });
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'TARGET_WAKING' || err.status === 503)) {
        if (attempt >= 4) {
          setWakingCrawl((prev) => (prev ? { ...prev, stillAsleep: true } : null));
        }
      } else {
        setWakingCrawl(null);
        let msg = errorMessage(err);
        if (err instanceof ApiError) {
          msg = presentError(err.code, err.details, err.message).body;
        }
        toast.error(msg);
        dispatch({ type: 'FAILED', message: msg });
      }
    }
  };

  const retryCrawlRef = useRef(retryCrawl);
  retryCrawlRef.current = retryCrawl;

  const wakingActive = wakingCrawl !== null && !wakingCrawl.stillAsleep;
  const wakingAttempt = wakingCrawl?.attempt;

  useEffect(() => {
    if (!wakingActive) return;
    const timer = setInterval(() => {
      setWakingCrawl((prev) => {
        if (!prev || prev.stillAsleep) return prev;
        if (prev.secondsLeft > 1) {
          return { ...prev, secondsLeft: prev.secondsLeft - 1 };
        }
        if (prev.attempt >= 4) {
          return { ...prev, stillAsleep: true };
        }
        void retryCrawlRef.current(prev.url, prev.attempt + 1);
        return { ...prev, attempt: prev.attempt + 1, secondsLeft: 30 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [wakingActive, wakingAttempt]);

  const { data: budget, mutate: mutateBudget } = useSWR<BudgetResponse, Error>(
    ['/api/budget', hasCustomKeys],
    () => getBudget(),
  );

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

  useEffect(() => {
    if (!router.isReady || autoCrawlDoneRef.current) return;
    const urlParam = router.query.url;
    const freshParam = router.query.fresh;
    const targetUrl = typeof urlParam === 'string' ? urlParam : Array.isArray(urlParam) ? urlParam[0] : null;
    const freshRequested = freshParam === '1' || freshParam === 'true';

    if (freshRequested) {
      setIsFresh(true);
    }

    if (targetUrl) {
      setQueryUrl(targetUrl);
      if (!autoCrawlDoneRef.current) {
        autoCrawlDoneRef.current = true;
        void handleCrawl(targetUrl);
      }
    }
  }, [router.isReady, router.query]);

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

  async function handleCrawl(rawUrl: string): Promise<void> {
    const classified = classifyTarget(rawUrl);
    const url = classified.normalized || rawUrl;
    const mode = getDeploymentMode();
    const isLocalApi = isLocal || getApiMode() === 'local-agent';

    if (
      !isLocal &&
      mode === 'hosted' &&
      !isLocalApi &&
      (classified.kind === 'loopback' || classified.kind === 'private')
    ) {
      setLocalTargetUrl(url);
      return;
    }

    setLocalTargetUrl(null);
    setWakingCrawl(null);
    dispatch({ type: 'CRAWL_STARTED' });

    try {
      const appMap = await crawlPage(url);
      const prefillTestData = loadRememberedTestData(url, appMap.elements);
      const prefillCount = Object.keys(prefillTestData).length;
      if (prefillCount > 0) {
        toast.success(`App map discovered: ${appMap.elements.length} elements (prefilled ${prefillCount} remembered field${prefillCount === 1 ? '' : 's'}).`);
      } else {
        toast.success(`App map discovered: ${appMap.elements.length} interactive elements.`);
      }
      dispatch({ type: 'CRAWL_SUCCEEDED', appMap, prefillTestData });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'TUNNEL_HOST_BLOCKED') {
          setLocalTargetUrl(url);
          dispatch({ type: 'FAILED', message: 'Tunnel host header rejected by dev server.' });
          return;
        }
        if (error.code === 'TARGET_WAKING' || error.status === 503) {
          let host = url;
          try {
            host = new URL(url).host;
          } catch {
            host = url.replace(/^https?:\/\//, '').split('/')[0];
          }
          setWakingCrawl({
            url,
            host,
            attempt: 1,
            secondsLeft: 30,
            stillAsleep: false,
          });
          return;
        }
        if (
          error.code === 'UPSTREAM_UNAVAILABLE' ||
          error.code === 'BROWSER_LAUNCH_FAILED'
        ) {
          toast.error(error.message);
          dispatch({ type: 'FAILED', message: error.message });
          return;
        }
      }
      let msg = errorMessage(error);
      if (error instanceof ApiError) {
        msg = presentError(error.code, error.details, error.message).body;
      }
      if (isTunnelUrl(url)) {
        msg +=
          ' (Tunnel URLs stop working when the cloudflared terminal is closed, and change every time you restart it. Re-run the command and paste the new URL.)';
      }
      toast.error(msg);
      dispatch({ type: 'FAILED', message: msg });
    }
  }

  async function handleGenerate(testDataByUrlParam?: Record<string, TestDataParam[]>): Promise<void> {
    if (!isLocal && !hasCustomKeys && !altchaPayload) {
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

    const testDataEntries: TestDataParam[] = [];
    if (state.appMap) {
      for (const [elementId, entry] of Object.entries(state.testData)) {
        if (!entry.value.trim()) continue;
        const elem = state.appMap.elements.find((el) => el.id === elementId);
        if (elem?.selectors?.css) {
          testDataEntries.push({
            elementId,
            css: elem.selectors.css,
            value: entry.value,
            sensitive: entry.sensitive,
          });
        }
      }
    }

    try {
      const { jobIds } = await startGeneration(urls, payloadToUse, {
        deepCrawl: state.deepCrawl,
        testData: testDataEntries.length > 0 ? testDataEntries : undefined,
        testDataByUrl: testDataByUrlParam,
        fresh: isFresh,
      });
      dispatch({ type: 'JOBS_ACCEPTED', jobIds });
      void mutateBudget();
      if (jobIds.length > 1) {
        toast.success(`${jobIds.length} jobs queued. They run one after another.`);
      }
    } catch (error) {
      void mutateBudget();
      let msg = handleGenerationError(error, {
        onQuota: (details) => {
          if (!isLocal) {
            setQuotaDetails(details);
          }
        },
      });
      if (error instanceof ApiError) {
        msg = presentError(error.code, error.details, error.message).body;
      }
      dispatch({ type: 'FAILED', message: msg });
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
            initialUrl={queryUrl}
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

      {wakingCrawl ? (
        <div
          className="error-banner mb-12"
          style={{ background: '#fffbeb', borderColor: '#fef3c7', color: '#92400e' }}
          role="status"
          aria-live="polite"
        >
          <span>
            <Warning aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <strong>Target waking up</strong>
            <p style={{ color: '#b45309' }}>
              {wakingCrawl.stillAsleep ? (
                <>
                  Still asleep. Open{' '}
                  <a
                    href={wakingCrawl.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'underline', fontWeight: 600 }}
                  >
                    {wakingCrawl.url}
                  </a>{' '}
                  in a new tab to wake it, then retry.
                </>
              ) : (
                `${wakingCrawl.host} is waking up from sleep (free hosting takes ~30–60 s). Retrying automatically in ${wakingCrawl.secondsLeft}s`
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="primary-button"
              style={{ padding: '6px 12px', fontSize: '11px' }}
              onClick={() => void retryCrawl(wakingCrawl.url, wakingCrawl.stillAsleep ? 1 : wakingCrawl.attempt)}
            >
              Retry now
            </button>
            <button
              type="button"
              className="secondary-button"
              style={{ padding: '6px 12px', fontSize: '11px' }}
              onClick={() => setWakingCrawl(null)}
            >
              {wakingCrawl.stillAsleep ? 'Dismiss' : 'Stop'}
            </button>
          </div>
        </div>
      ) : null}

      {!isLocal && quotaDetails ? (
        <QuotaExhaustedPanel
          limit={quotaDetails.limit}
          onDismiss={() => setQuotaDetails(null)}
          resetsAt={quotaDetails.resetsAt}
          scope={quotaDetails.scope}
        />
      ) : null}

      {state.error && !quotaDetails && !wakingCrawl ? (
        <div className="mb-12">
          <ErrorNotice
            title="Request failed"
            body={state.error}
            raw={state.error}
          />
          {state.jobIds[0] ? (
            <div className="mt-2 text-right">
              <Link
                className="inline-flex items-center gap-1.5 font-bold text-xs"
                href={`/jobs/${state.jobIds[0]}`}
              >
                Open job
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {state.appMap && state.phase !== 'submitting' && !groupRunning ? (
        <CrawlPreview
          key={`${state.appMap.url}|${state.appMap.crawledAt ?? state.appMap.elements.length}`}
          appMap={state.appMap}
          budget={budget}
          deepCrawl={state.deepCrawl}
          disabled={!isLocal && !hasCustomKeys && !altchaPayload}
          generating={false}
          onGenerate={(testDataByUrl) => void handleGenerate(testDataByUrl)}
          onReset={() => {
            setAltchaPayload(null);
            dispatch({ type: 'RESET' });
          }}
          onToggleDeepCrawl={(v) => dispatch({ type: 'SET_DEEP_CRAWL', enabled: v })}
          onToggleUrl={(url) => dispatch({ type: 'TOGGLE_URL', url })}
          onUpdateTestData={(elementId, value, sensitive) =>
            dispatch({ type: 'SET_TEST_DATA', elementId, value, sensitive })
          }
          selectedUrls={state.selectedUrls}
          testData={state.testData}
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

      {!isLocal && state.appMap && state.phase !== 'submitting' && !groupRunning && !hasCustomKeys ? (
        <PowWidget key={powEpoch} onPayload={setAltchaPayload} />
      ) : null}

      <HowItWorks />
    </>
  );
}
