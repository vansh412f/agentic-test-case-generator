import { Globe, Tabs, ArrowRight, CircleNotch } from '@phosphor-icons/react';
import { useMemo, useState, useEffect } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { PowWidget } from '@/components/home/PowWidget';
import { QuotaExhaustedPanel } from '@/components/home/QuotaExhaustedPanel';
import { RunGroupList } from '@/components/home/RunGroupList';
import { ErrorNotice } from '@/components/common/ErrorNotice';
import { PageTestData } from '@/components/home/PageTestData';
import { useBackendMode } from '@/hooks/useBackendMode';
import {
  apiBase,
  crawlPage,
  fetcher,
  getBudget,
  hasConfiguredKeys,
  startGeneration,
  type BudgetResponse,
  type TestDataParam,
  ApiError,
} from '@/lib/api';
import { handleGenerationError } from '@/lib/generationErrors';
import { presentError } from '@/lib/errorPresentation';
import { loadRememberedTestData } from '@/lib/rememberedTestData';
import { isTerminalJobStatus } from '@/lib/utils';
import type { AppMap, JobDetail, JobsListResponse } from '@/types/api';

interface ContinueTestingProps {
  job: JobDetail;
}

function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    return parsed.href.replace(/\/$/, '');
  } catch {
    return u.trim().replace(/\/$/, '');
  }
}

export function ContinueTesting({ job }: ContinueTestingProps) {
  const { isLocal } = useBackendMode();
  const [isOpen, setIsOpen] = useState(false);
  const [hasCustomKeys, setHasCustomKeys] = useState(false);
  const [altchaPayload, setAltchaPayload] = useState<string | null>(null);
  const [powEpoch, setPowEpoch] = useState(0);

  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [selectedTabs, setSelectedTabs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaDetails, setQuotaDetails] = useState<{ limit?: number; resetsAt?: string } | null>(null);

  const [createdJobIds, setCreatedJobIds] = useState<string[] | null>(null);
  const [submittedUrls, setSubmittedUrls] = useState<string[]>([]);

  const [pageAppMaps, setPageAppMaps] = useState<Record<string, AppMap>>({});
  const [crawlingUrls, setCrawlingUrls] = useState<Record<string, boolean>>({});
  const [testDataByUrl, setTestDataByUrl] = useState<
    Record<string, Record<string, { value: string; sensitive: boolean }>>
  >({});

  const isTerminal = isTerminalJobStatus(job.status);
  const { data: appMapData, isLoading: appMapLoading } = useSWR<{ appMap: AppMap | null }>(
    isTerminal ? `${apiBase()}/api/jobs/${job.id}/appmap` : null,
    fetcher,
  );
  const appMap = appMapData?.appMap ?? job.appMap;

  const { data: budget } = useSWR<BudgetResponse, Error>(
    ['/api/budget', hasCustomKeys],
    () => getBudget(),
  );
  const maxAllowedUrls = isLocal
    ? (budget?.maxUrlsPerRun ?? 10)
    : (budget?.maxUrlsPerRun ?? (hasCustomKeys ? 5 : 3));

  useEffect(() => {
    setHasCustomKeys(hasConfiguredKeys());
  }, []);

  const { eligiblePages, eligibleTabs } = useMemo(() => {
    if (!appMap) return { eligiblePages: [], eligibleTabs: [] };

    const excludedUrls = new Set([
      normalizeUrl(job.targetUrl),
      ...(appMap.pages?.map((p) => normalizeUrl(p.url)) ?? []),
      ...(appMap.pages?.map((p) => normalizeUrl(p.requestedUrl)) ?? []),
    ]);

    const uniqueLinks = Array.from(new Set(appMap.discoveredLinks ?? []));
    const pages = uniqueLinks
      .filter((link) => !excludedUrls.has(normalizeUrl(link)))
      .slice(0, 20);

    const tabs = (appMap.elements ?? [])
      .filter((el) => el.ariaRole === 'tab' && (!el.page || el.page === 1) && el.selectors?.css)
      .slice(0, 12);

    return { eligiblePages: pages, eligibleTabs: tabs };
  }, [appMap, job.targetUrl]);

  // Poll job status once jobs are created
  const { data: groupList } = useSWR<JobsListResponse, Error>(
    createdJobIds && createdJobIds.length > 0 ? `${apiBase()}/api/jobs?page=1&limit=20` : null,
    fetcher,
    {
      refreshInterval: (latest) =>
        latest !== undefined &&
        createdJobIds?.every((id) => {
          const summary = latest.jobs.find((j) => j.id === id);
          return summary !== undefined && isTerminalJobStatus(summary.status);
        })
          ? 0
          : 3000,
    },
  );

  const groupSummaries = useMemo(() => {
    return (groupList?.jobs ?? []).filter((j) => createdJobIds?.includes(j.id));
  }, [groupList?.jobs, createdJobIds]);

  if (!appMapLoading && eligiblePages.length === 0 && eligibleTabs.length === 0) {
    return null;
  }

  const togglePage = async (pageUrl: string) => {
    const willSelect = !selectedPages.includes(pageUrl);
    setSelectedPages((prev) =>
      prev.includes(pageUrl)
        ? prev.filter((p) => p !== pageUrl)
        : prev.length < maxAllowedUrls
          ? [...prev, pageUrl]
          : prev,
    );

    if (willSelect && !pageAppMaps[pageUrl] && !crawlingUrls[pageUrl]) {
      setCrawlingUrls((prev) => ({ ...prev, [pageUrl]: true }));
      try {
        const result = await crawlPage(pageUrl);
        setPageAppMaps((prev) => ({ ...prev, [pageUrl]: result }));
        const rem = loadRememberedTestData(pageUrl, result.elements);
        setTestDataByUrl((prev) => ({ ...prev, [pageUrl]: rem }));
      } catch {
        // Keep without appMap if crawl failed
      } finally {
        setCrawlingUrls((prev) => ({ ...prev, [pageUrl]: false }));
      }
    }
  };

  const toggleTab = (id: string) => {
    setSelectedTabs((prev) =>
      prev.includes(id)
        ? prev.filter((t) => t !== id)
        : prev.length < 5
          ? [...prev, id]
          : prev,
    );
  };

  const buildTestDataByUrlParam = (): Record<string, TestDataParam[]> | undefined => {
    const result: Record<string, TestDataParam[]> = {};
    for (const pageUrl of selectedPages) {
      const pageMap = pageAppMaps[pageUrl];
      const pageData = testDataByUrl[pageUrl];
      if (pageMap && pageData) {
        const entries: TestDataParam[] = [];
        for (const [elementId, entry] of Object.entries(pageData)) {
          if (!entry.value.trim()) continue;
          const el = pageMap.elements.find((e) => e.id === elementId);
          if (el?.selectors?.css) {
            entries.push({
              elementId,
              css: el.selectors.css,
              value: entry.value,
              sensitive: entry.sensitive,
            });
          }
        }
        if (entries.length > 0) {
          result[pageUrl] = entries;
        }
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };

  async function handleGeneratePages() {
    if (selectedPages.length === 0 || submitting) return;
    if (!isLocal && !hasCustomKeys && !altchaPayload) {
      toast('Bot check is still running — one moment');
      return;
    }
    const payloadToUse = altchaPayload ?? undefined;
    setAltchaPayload(null);
    setPowEpoch((e) => e + 1);
    setSubmitting(true);
    setError(null);
    setQuotaDetails(null);

    const tdParam = buildTestDataByUrlParam();

    try {
      const { jobIds } = await startGeneration(selectedPages, payloadToUse, {
        testDataByUrl: tdParam,
      });
      setSubmittedUrls(selectedPages);
      setCreatedJobIds(jobIds);
      toast.success(`${jobIds.length} ${jobIds.length === 1 ? 'job' : 'jobs'} queued.`);
    } catch (err) {
      let msg = handleGenerationError(err, {
        onQuota: (details) => {
          if (!isLocal) {
            setQuotaDetails(details);
          }
        },
      });
      if (err instanceof ApiError) {
        msg = presentError(err.code, err.details, err.message).body;
      }
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGenerateTabs() {
    if (selectedTabs.length === 0 || submitting) return;
    if (!isLocal && !hasCustomKeys && !altchaPayload) {
      toast('Bot check is still running — one moment');
      return;
    }
    const payloadToUse = altchaPayload ?? undefined;
    setAltchaPayload(null);
    setPowEpoch((e) => e + 1);
    setSubmitting(true);
    setError(null);
    setQuotaDetails(null);

    const focusElements = selectedTabs
      .map((id) => {
        const el = eligibleTabs.find((t) => t.id === id);
        return el?.selectors?.css ? { elementId: el.id, css: el.selectors.css } : null;
      })
      .filter((f): f is { elementId: string; css: string } => f !== null);

    try {
      const urls = [job.targetUrl];
      const { jobIds } = await startGeneration(urls, payloadToUse, { focus: focusElements });
      setSubmittedUrls(urls);
      setCreatedJobIds(jobIds);
      toast.success('Focused test generation queued.');
    } catch (err) {
      let msg = handleGenerationError(err, {
        onQuota: (details) => {
          if (!isLocal) {
            setQuotaDetails(details);
          }
        },
      });
      if (err instanceof ApiError) {
        msg = presentError(err.code, err.details, err.message).body;
      }
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const buttonsDisabled = submitting || (!isLocal && !hasCustomKeys && !altchaPayload);

  if (!isOpen) {
    return (
      <section className="detail-section continue-testing continue-testing-root">
        <div className="detail-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p className="eyebrow">CONTINUE TESTING</p>
            <h2>Expand test coverage to discovered pages and tabs</h2>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setIsOpen(true)}
          >
            Explore Pages & Tabs <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </section>
    );
  }

  if (appMapLoading) {
    return (
      <section className="detail-section continue-testing continue-testing-root">
        <div className="detail-heading">
          <div>
            <p className="eyebrow">CONTINUE TESTING</p>
            <h2>Loading discovered pages and tabs…</h2>
          </div>
        </div>
      </section>
    );
  }

  if (!appMap || (eligiblePages.length === 0 && eligibleTabs.length === 0)) {
    return (
      <section className="detail-section continue-testing continue-testing-root">
        <div className="detail-heading">
          <div>
            <p className="eyebrow">CONTINUE TESTING</p>
            <h2>No additional pages or tabs discovered for this target.</h2>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="detail-section continue-testing continue-testing-root">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">CONTINUE TESTING</p>
          <h2>
            Found {eligiblePages.length} {eligiblePages.length === 1 ? 'page' : 'pages'} and{' '}
            {eligibleTabs.length} {eligibleTabs.length === 1 ? 'tab' : 'tabs'}. Pick what to test next.
          </h2>
        </div>
      </div>

      {!isLocal && quotaDetails && (
        <QuotaExhaustedPanel
          limit={quotaDetails.limit}
          onDismiss={() => setQuotaDetails(null)}
          resetsAt={quotaDetails.resetsAt}
        />
      )}

      {error && !quotaDetails && (
        <div className="mb-6" style={{ marginTop: '12px' }}>
          <ErrorNotice
            title="Request failed"
            body={error}
            raw={error}
          />
        </div>
      )}

      {createdJobIds && createdJobIds.length > 0 ? (
        <div className="continue-testing-group-wrapper">
          <RunGroupList
            jobIds={createdJobIds}
            submittedUrls={submittedUrls}
            summaries={groupSummaries}
          />
        </div>
      ) : (
        <div className="continue-testing-body">
          {/* Pages picker */}
          {eligiblePages.length > 0 && (
            <div>
              <h3 className="continue-testing-heading">
                Discovered Pages (Select up to {maxAllowedUrls})
              </h3>
              <div className="continue-testing-list">
                {eligiblePages.map((pageUrl) => {
                  const isSelected = selectedPages.includes(pageUrl);
                  const isMax = selectedPages.length >= maxAllowedUrls;
                  const isCrawling = crawlingUrls[pageUrl];
                  const pageMap = pageAppMaps[pageUrl];

                  return (
                    <label
                      key={pageUrl}
                      className={`continue-testing-item ${!isSelected && isMax ? 'is-disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={submitting || isCrawling || (!isSelected && isMax)}
                        onChange={() => void togglePage(pageUrl)}
                      />
                      <Globe aria-hidden="true" className="h-4 w-4 continue-testing-icon" />
                      <span className="continue-testing-url-span">
                        {pageUrl}
                      </span>
                      {isCrawling ? (
                        <span style={{ fontSize: '11px', color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <CircleNotch aria-hidden="true" className="h-3 w-3 animate-spin" /> Scanning…
                        </span>
                      ) : pageMap ? (
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>
                          {pageMap.elements.length} elements
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>

              {/* Per-page test data */}
              {selectedPages.length > 0 && (
                <PageTestData
                  pages={selectedPages.map((url) => ({
                    url,
                    title: pageAppMaps[url]?.title,
                    elements: pageAppMaps[url]?.elements ?? [],
                  }))}
                  testDataByUrl={testDataByUrl}
                  onUpdateField={(pageUrl, elementId, value, sensitive) => {
                    setTestDataByUrl((prev) => ({
                      ...prev,
                      [pageUrl]: {
                        ...(prev[pageUrl] ?? {}),
                        [elementId]: { value, sensitive },
                      },
                    }));
                  }}
                  disabled={submitting}
                />
              )}
            </div>
          )}

          {/* Tabs picker */}
          {eligibleTabs.length > 0 && (
            <div>
              <h3 className="continue-testing-heading">
                Tabs & Views (Select up to 5)
              </h3>
              <div className="continue-testing-list">
                {eligibleTabs.map((tab) => {
                  const isSelected = selectedTabs.includes(tab.id);
                  const isMax = selectedTabs.length >= 5;
                  const label = tab.text || tab.ariaLabel || tab.id;
                  return (
                    <label
                      key={tab.id}
                      className={`continue-testing-item ${!isSelected && isMax ? 'is-disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={submitting || (!isSelected && isMax)}
                        onChange={() => toggleTab(tab.id)}
                      />
                      <Tabs aria-hidden="true" className="h-4 w-4 continue-testing-icon" />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* PoW Challenge if needed in hosted mode */}
          {!isLocal && !hasCustomKeys && (
            <div className="continue-testing-pow">
              <PowWidget key={powEpoch} onPayload={setAltchaPayload} />
            </div>
          )}

          {/* Action Buttons */}
          <div className="continue-testing-actions">
            {eligiblePages.length > 0 && (
              <button
                type="button"
                className="primary-button continue-testing-btn"
                disabled={buttonsDisabled || selectedPages.length === 0}
                onClick={() => void handleGeneratePages()}
              >
                {submitting
                  ? 'Submitting…'
                  : `Generate tests for ${selectedPages.length} ${selectedPages.length === 1 ? 'page' : 'pages'}`}{' '}
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}

            {eligibleTabs.length > 0 && (
              <button
                type="button"
                className="secondary-button continue-testing-btn"
                disabled={buttonsDisabled || selectedTabs.length === 0}
                onClick={() => void handleGenerateTabs()}
              >
                {submitting
                  ? 'Submitting…'
                  : `Focused tests for ${selectedTabs.length} ${selectedTabs.length === 1 ? 'tab' : 'tabs'}`}{' '}
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
