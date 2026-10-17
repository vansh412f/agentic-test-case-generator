import { ArrowRight, Check, Globe, Warning } from '@phosphor-icons/react';
import type { AppMap } from '@/types/api';

interface CrawlPreviewProps {
  appMap: AppMap;
  selectedUrls: string[];
  generating: boolean;
  disabled?: boolean;
  deepCrawl?: boolean;
  onToggleDeepCrawl?: (enabled: boolean) => void;
  onToggleUrl: (url: string) => void;
  onGenerate: () => void;
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
  onToggleDeepCrawl,
  onToggleUrl,
  onGenerate,
  onReset,
}: CrawlPreviewProps) {
  const totalPagesCount = 1 + appMap.discoveredLinks.length;
  const maxReached = selectedUrls.length >= 5;
  const canDeepCrawl =
    onToggleDeepCrawl !== undefined &&
    selectedUrls.length === 1 &&
    appMap.discoveredLinks.length > 0;

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
          <span className="warning" style={{ margin: 0, padding: '6px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, alignItems: 'center' }}>
            <Warning aria-hidden="true" className="h-3.5 w-3.5" /> No elements found
          </span>
        ) : appMap.isTruncated ? (
          <span className="warning" style={{ margin: 0, padding: '6px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, alignItems: 'center' }}>
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

          return (
            <label className="page-row" key={link}>
              <input
                checked={isSelected}
                disabled={isDisabled}
                onChange={() => onToggleUrl(link)}
                type="checkbox"
              />
              <span className="page-icon">
                <Globe aria-hidden="true" className="h-4 w-4" />
              </span>
              <span className="page-name">
                <strong>{formatPageTitle(link)}</strong>
                <code>{formatPathname(link)}</code>
              </span>
              <span className="page-meta">Discovered page</span>
            </label>
          );
        })}
      </div>

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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
            onClick={onGenerate}
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
    </section>
  );
}
