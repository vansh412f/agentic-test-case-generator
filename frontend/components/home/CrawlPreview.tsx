import { ArrowRight, Check, Globe, Warning, CircleNotch } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import type { AppMap } from '@/types/api';
import { crawlPage, ApiError, type BudgetResponse, type TestDataParam } from '@/lib/api';
import { useBackendMode } from '@/hooks/useBackendMode';
import { loadRememberedTestData } from '@/lib/rememberedTestData';
import { PageTestData } from './PageTestData';

interface CrawlPreviewProps {
  appMap: AppMap;
  selectedUrls: string[];
  generating: boolean;
  disabled?: boolean;
  deepCrawl?: boolean;
  testData?: Record<string, { value: string; sensitive: boolean }>;
  budget?: BudgetResponse | null;
  maxUrlsPerRun?: number;
  onToggleDeepCrawl?: (enabled: boolean) => void;
  onToggleUrl: (url: string) => void;
  onUpdateTestData?: (elementId: string, value: string, sensitive: boolean) => void;
  onGenerate: (testDataByUrl?: Record<string, TestDataParam[]>) => void;
  onReset: () => void;
}

function formatPathname(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return parsed.pathname === '/' ? '/' : parsed.pathname;
  } catch {
    return urlStr;
  }
}

function formatPageTitle(urlStr: string, defaultTitle?: string): string {
  if (defaultTitle && defaultTitle.trim().length > 0) {
    return defaultTitle;
  }
  try {
    const parsed = new URL(urlStr);
    const path = parsed.pathname.replace(/^\/|\/$/g, '');
    if (!path) return 'Home';
    const lastPart = path.split('/').pop() || 'Page';
    return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
  } catch {
    return 'Page';
  }
}

export function CrawlPreview({
  appMap,
  selectedUrls,
  generating,
  disabled = false,
  deepCrawl = false,
  budget,
  maxUrlsPerRun,
  onToggleDeepCrawl,
  onToggleUrl,
  onGenerate,
  onReset,
}: CrawlPreviewProps) {
  const { isLocal } = useBackendMode();
  const confirmDialogRef = useRef<HTMLDialogElement>(null);

  const [pageAppMaps, setPageAppMaps] = useState<Record<string, AppMap>>(() => ({
    [appMap.url]: appMap,
  }));
  const [crawlingUrls, setCrawlingUrls] = useState<Record<string, boolean>>({});
  const [crawlErrors, setCrawlErrors] = useState<Record<string, string>>({});

  const [testDataByUrl, setTestDataByUrl] = useState<
    Record<string, Record<string, { value: string; sensitive: boolean }>>
  >(() => ({
    [appMap.url]: loadRememberedTestData(appMap.url, appMap.elements),
  }));

  const totalPagesCount = 1 + appMap.discoveredLinks.length;
  const maxAllowedUrls = isLocal
    ? (budget?.maxUrlsPerRun ?? 10)
    : (maxUrlsPerRun ?? budget?.maxUrlsPerRun ?? (budget?.byok ? 5 : 3));
  const maxReached = selectedUrls.length >= maxAllowedUrls;
  const canDeepCrawl =
    onToggleDeepCrawl !== undefined &&
    selectedUrls.length === 1 &&
    appMap.discoveredLinks.length > 0;

  const visitorScope = budget?.scopes?.find((s) => s.scope === 'visitor');
  const limit = visitorScope?.limit ?? 8;
  const remaining = budget?.remaining ?? null;
  const budgetCopy = isLocal
    ? null
    : budget?.byok
    ? 'Unlimited with your key, one run at a time'
    : remaining !== null
    ? `${remaining} of ${limit} free runs left today`
    : null;

  const handleTogglePage = async (link: string) => {
    const willSelect = !selectedUrls.includes(link);
    onToggleUrl(link);

    if (willSelect && !pageAppMaps[link] && !crawlingUrls[link]) {
      setCrawlingUrls((prev) => ({ ...prev, [link]: true }));
      setCrawlErrors((prev) => {
        const next = { ...prev };
        delete next[link];
        return next;
      });

      try {
        const result = await crawlPage(link);
        setPageAppMaps((prev) => ({ ...prev, [link]: result }));
        const rem = loadRememberedTestData(link, result.elements);
        setTestDataByUrl((prev) => ({ ...prev, [link]: rem }));
      } catch (err) {
        if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
          setCrawlErrors((prev) => ({ ...prev, [link]: 'Daily limit reached' }));
        } else if (err instanceof ApiError) {
          setCrawlErrors((prev) => ({ ...prev, [link]: err.message || 'Crawl failed' }));
        } else {
          setCrawlErrors((prev) => ({ ...prev, [link]: 'Could not crawl page' }));
        }
      } finally {
        setCrawlingUrls((prev) => ({ ...prev, [link]: false }));
      }
    }
  };

  const buildTestDataByUrlParam = (): Record<string, TestDataParam[]> | undefined => {
    const result: Record<string, TestDataParam[]> = {};
    for (const pageUrl of selectedUrls) {
      const pageMap = pageAppMaps[pageUrl] ?? (pageUrl === appMap.url ? appMap : undefined);
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

  const handleGenerateClick = () => {
    const tdParam = buildTestDataByUrlParam();
    if (!isLocal && selectedUrls.length > 1) {
      confirmDialogRef.current?.showModal();
    } else {
      onGenerate(tdParam);
    }
  };

  const handleConfirmRun = () => {
    confirmDialogRef.current?.close();
    const tdParam = buildTestDataByUrlParam();
    onGenerate(tdParam);
  };

  const pagesForTestData = useMemo(() => {
    return selectedUrls.map((url) => ({
      url,
      title: pageAppMaps[url]?.title,
      elements: pageAppMaps[url]?.elements ?? (url === appMap.url ? appMap.elements : []),
    }));
  }, [selectedUrls, pageAppMaps, appMap]);

  return (
    <section aria-labelledby="app-map-title" className="app-map">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Crawl complete</p>
          <h2 id="app-map-title">App Map</h2>
          <p>
            {totalPagesCount} {totalPagesCount === 1 ? 'page' : 'pages'} and{' '}
            {appMap.elements.length} interactive elements discovered.
          </p>
        </div>
        {appMap.elements.length === 0 ? (
          <span
            className="warning"
            style={{
              margin: 0,
              padding: '6px 10px',
              borderRadius: '20px',
              fontSize: '10px',
              fontWeight: 700,
              alignItems: 'center',
            }}
          >
            <Warning aria-hidden="true" className="h-3.5 w-3.5" /> No elements found
          </span>
        ) : appMap.isTruncated ? (
          <span
            className="warning"
            style={{
              margin: 0,
              padding: '6px 10px',
              borderRadius: '20px',
              fontSize: '10px',
              fontWeight: 700,
              alignItems: 'center',
            }}
          >
            <Warning aria-hidden="true" className="h-3.5 w-3.5" /> Crawl truncated
          </span>
        ) : (
          <span className="success-pill">
            <Check aria-hidden="true" className="h-3.5 w-3.5" /> Healthy crawl
          </span>
        )}
      </div>

      <div className="page-list">
        {/* Main crawled page */}
        <label className="page-row">
          <input
            checked={selectedUrls.includes(appMap.url)}
            disabled
            type="checkbox"
          />
          <span className="page-icon">
            <Globe aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="page-name">
            <strong>{formatPageTitle(appMap.url, appMap.title)}</strong>
            <code>{formatPathname(appMap.url)}</code>
          </span>
          <span className="page-meta">
            {appMap.elements.length} elements · {appMap.forms.length}{' '}
            {appMap.forms.length === 1 ? 'form' : 'forms'}
          </span>
        </label>

        {/* Additional discovered pages */}
        {appMap.discoveredLinks.map((link) => {
          const isSelected = selectedUrls.includes(link);
          const isDisabled = generating || (!isSelected && maxReached);
          const isCrawling = crawlingUrls[link];
          const errorMsg = crawlErrors[link];
          const crawledMap = pageAppMaps[link];

          return (
            <label className="page-row" key={link}>
              <input
                checked={isSelected}
                disabled={isDisabled || isCrawling}
                onChange={() => void handleTogglePage(link)}
                type="checkbox"
              />
              <span className="page-icon">
                <Globe aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="page-name">
                <strong>{formatPageTitle(link, crawledMap?.title)}</strong>
                <code>{formatPathname(link)}</code>
              </span>
              <span className="page-meta">
                {isCrawling ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#6b7280' }}>
                    <CircleNotch aria-hidden="true" className="h-3 w-3 animate-spin" /> Scanning…
                  </span>
                ) : errorMsg ? (
                  <span style={{ color: '#dc2626', fontWeight: 600 }}>{errorMsg}</span>
                ) : crawledMap ? (
                  <span>
                    {crawledMap.elements.length} elements · {crawledMap.forms.length} forms
                  </span>
                ) : (
                  <span>Discovered page</span>
                )}
              </span>
            </label>
          );
        })}
      </div>

      {/* Per-page test data component */}
      <PageTestData
        pages={pagesForTestData}
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
        disabled={generating || disabled}
      />

      {canDeepCrawl && (
        <label className="deep-crawl-toggle">
          <input
            type="checkbox"
            checked={Boolean(deepCrawl)}
            disabled={generating || disabled}
            onChange={(e) => onToggleDeepCrawl?.(e.target.checked)}
          />
          <div>
            <strong>Deep crawl (experimental)</strong>
            <small>
              Also maps up to 2 linked pages so tests can cover journeys that cross pages. Slower; still counts as one run.
            </small>
          </div>
        </label>
      )}

      <div className="map-footer">
        <span>
          {selectedUrls.length} of {totalPagesCount} pages selected
          {canDeepCrawl && deepCrawl ? ' · deep crawl on' : ''}
        </span>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {budgetCopy && (
            <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>
              {budgetCopy}
            </span>
          )}
          <button
            className="secondary-button"
            disabled={generating}
            onClick={onReset}
            type="button"
          >
            Start Over
          </button>
          <button
            className="primary-button"
            disabled={disabled || generating || selectedUrls.length === 0}
            onClick={handleGenerateClick}
            type="button"
          >
            {generating
              ? 'Generating Tests…'
              : disabled
                ? 'Verifying…'
                : 'Generate Tests'}{' '}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <dialog
        ref={confirmDialogRef}
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          padding: '24px',
          maxWidth: '460px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        }}
      >
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 10px 0', color: '#111827' }}>
          Run {selectedUrls.length} pages?
        </h3>
        <p style={{ fontSize: '13px', color: '#4b5563', margin: '0 0 20px 0', lineHeight: 1.5 }}>
          {budget?.byok
            ? `Run ${selectedUrls.length} pages? Pages run one after another (~2–4 min each).`
            : `Run ${selectedUrls.length} pages? This uses ${selectedUrls.length} of your ${remaining ?? 0} free runs today. Pages run one after another (~2–4 min each).`}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            className="secondary-button"
            onClick={() => confirmDialogRef.current?.close()}
            type="button"
          >
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={handleConfirmRun}
            type="button"
          >
            Run {selectedUrls.length} pages
          </button>
        </div>
      </dialog>
    </section>
  );
}
