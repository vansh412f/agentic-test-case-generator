import { Globe, Tabs, Warning, ArrowRight } from '@phosphor-icons/react';
import { useMemo, useState, useEffect } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { PowWidget } from '@/components/home/PowWidget';
import { QuotaExhaustedPanel } from '@/components/home/QuotaExhaustedPanel';
import { RunGroupList } from '@/components/home/RunGroupList';
import {
  apiBase,
  fetcher,
  hasConfiguredKeys,
  startGeneration,
  type BudgetResponse,
} from '@/lib/api';
import { handleGenerationError } from '@/lib/generationErrors';
import { isTerminalJobStatus } from '@/lib/utils';
import type { JobDetail, JobsListResponse } from '@/types/api';

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

  const { data: budget } = useSWR<BudgetResponse, Error>('/api/budget', fetcher);
  const maxAllowedUrls = budget?.maxUrlsPerRun ?? (hasCustomKeys ? 5 : 3);

  useEffect(() => {
    setHasCustomKeys(hasConfiguredKeys());
  }, []);

  const { eligiblePages, eligibleTabs } = useMemo(() => {
    if (!job.appMap) return { eligiblePages: [], eligibleTabs: [] };

    const excludedUrls = new Set([
      normalizeUrl(job.targetUrl),
      ...(job.appMap.pages?.map((p) => normalizeUrl(p.url)) ?? []),
      ...(job.appMap.pages?.map((p) => normalizeUrl(p.requestedUrl)) ?? []),
    ]);

    const uniqueLinks = Array.from(new Set(job.appMap.discoveredLinks ?? []));
    const pages = uniqueLinks
      .filter((link) => !excludedUrls.has(normalizeUrl(link)))
      .slice(0, 20);

    const tabs = (job.appMap.elements ?? [])
      .filter((el) => el.ariaRole === 'tab' && (!el.page || el.page === 1) && el.selectors?.css)
      .slice(0, 12);

    return { eligiblePages: pages, eligibleTabs: tabs };
  }, [job.appMap, job.targetUrl]);

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

  if (eligiblePages.length === 0 && eligibleTabs.length === 0) {
    return null;
  }

  const togglePage = (url: string) => {
    setSelectedPages((prev) =>
      prev.includes(url)
        ? prev.filter((p) => p !== url)
        : prev.length < maxAllowedUrls
          ? [...prev, url]
          : prev,
    );
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

  async function handleGeneratePages() {
    if (selectedPages.length === 0 || submitting) return;
    if (!hasCustomKeys && !altchaPayload) {
      toast('Bot check is still running — one moment');
      return;
    }
    const payloadToUse = altchaPayload ?? undefined;
    setAltchaPayload(null);
    setPowEpoch((e) => e + 1);
    setSubmitting(true);
    setError(null);
    setQuotaDetails(null);

    try {
      const { jobIds } = await startGeneration(selectedPages, payloadToUse);
      setSubmittedUrls(selectedPages);
      setCreatedJobIds(jobIds);
      toast.success(`${jobIds.length} ${jobIds.length === 1 ? 'job' : 'jobs'} queued.`);
    } catch (err) {
      const msg = handleGenerationError(err, {
        onQuota: (details) => setQuotaDetails(details),
      });
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGenerateTabs() {
    if (selectedTabs.length === 0 || submitting) return;
    if (!hasCustomKeys && !altchaPayload) {
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
      const msg = handleGenerationError(err, {
        onQuota: (details) => setQuotaDetails(details),
      });
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const buttonsDisabled = submitting || (!hasCustomKeys && !altchaPayload);

  return (
    <section className="detail-section continue-testing" style={{ marginTop: '30px' }}>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">CONTINUE TESTING</p>
          <h2>
            Found {eligiblePages.length} {eligiblePages.length === 1 ? 'page' : 'pages'} and{' '}
            {eligibleTabs.length} {eligibleTabs.length === 1 ? 'tab' : 'tabs'}. Pick what to test next.
          </h2>
        </div>
      </div>

      {quotaDetails && (
        <QuotaExhaustedPanel
          limit={quotaDetails.limit}
          onDismiss={() => setQuotaDetails(null)}
          resetsAt={quotaDetails.resetsAt}
        />
      )}

      {error && !quotaDetails && (
        <div className="error-banner mb-6" role="alert" style={{ marginTop: '12px' }}>
          <span>
            <Warning aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <strong>Request failed</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {createdJobIds && createdJobIds.length > 0 ? (
        <div style={{ marginTop: '20px' }}>
          <RunGroupList
            jobIds={createdJobIds}
            submittedUrls={submittedUrls}
            summaries={groupSummaries}
          />
        </div>
      ) : (
        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Pages picker */}
          {eligiblePages.length > 0 && (
            <div>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#374151', marginBottom: '8px' }}>
                Discovered Pages (Select up to {maxAllowedUrls})
              </h3>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  maxHeight: '220px',
                  overflowY: 'auto',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '10px',
                  background: '#f9fafb',
                }}
              >
                {eligiblePages.map((pageUrl) => {
                  const isSelected = selectedPages.includes(pageUrl);
                  const isMax = selectedPages.length >= maxAllowedUrls;
                  return (
                    <label
                      key={pageUrl}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '12px',
                        cursor: isSelected || !isMax ? 'pointer' : 'not-allowed',
                        opacity: !isSelected && isMax ? 0.6 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={submitting || (!isSelected && isMax)}
                        onChange={() => togglePage(pageUrl)}
                      />
                      <Globe aria-hidden="true" className="h-4 w-4" style={{ color: '#6b7280' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pageUrl}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabs picker */}
          {eligibleTabs.length > 0 && (
            <div>
              <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#374151', marginBottom: '8px' }}>
                Tabs & Views (Select up to 5)
              </h3>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  maxHeight: '220px',
                  overflowY: 'auto',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '10px',
                  background: '#f9fafb',
                }}
              >
                {eligibleTabs.map((tab) => {
                  const isSelected = selectedTabs.includes(tab.id);
                  const isMax = selectedTabs.length >= 5;
                  const label = tab.text || tab.ariaLabel || tab.id;
                  return (
                    <label
                      key={tab.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '12px',
                        cursor: isSelected || !isMax ? 'pointer' : 'not-allowed',
                        opacity: !isSelected && isMax ? 0.6 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={submitting || (!isSelected && isMax)}
                        onChange={() => toggleTab(tab.id)}
                      />
                      <Tabs aria-hidden="true" className="h-4 w-4" style={{ color: '#6b7280' }} />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* PoW Challenge if needed */}
          {!hasCustomKeys && (
            <div style={{ marginTop: '4px' }}>
              <PowWidget key={powEpoch} onPayload={setAltchaPayload} />
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
            {eligiblePages.length > 0 && (
              <button
                type="button"
                className="primary-button"
                disabled={buttonsDisabled || selectedPages.length === 0}
                onClick={() => void handleGeneratePages()}
                style={{ padding: '8px 16px', fontSize: '13px' }}
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
                className="secondary-button"
                disabled={buttonsDisabled || selectedTabs.length === 0}
                onClick={() => void handleGenerateTabs()}
                style={{ padding: '8px 16px', fontSize: '13px' }}
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
