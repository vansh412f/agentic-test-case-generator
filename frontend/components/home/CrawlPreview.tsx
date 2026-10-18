import { ArrowRight, Check, Globe, Warning, Lock, LockOpen } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { AppMap, InteractiveElement } from '@/types/api';

interface CrawlPreviewProps {
  appMap: AppMap;
  selectedUrls: string[];
  generating: boolean;
  disabled?: boolean;
  deepCrawl?: boolean;
  testData: Record<string, { value: string; sensitive: boolean }>;
  onToggleDeepCrawl?: (enabled: boolean) => void;
  onToggleUrl: (url: string) => void;
  onUpdateTestData: (elementId: string, value: string, sensitive: boolean) => void;
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

const EXCLUDED_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'checkbox',
  'radio',
  'file',
  'image',
  'reset',
  'range',
  'color',
]);

export function CrawlPreview({
  appMap,
  selectedUrls,
  generating,
  disabled = false,
  deepCrawl = false,
  testData,
  onToggleDeepCrawl,
  onToggleUrl,
  onUpdateTestData,
  onGenerate,
  onReset,
}: CrawlPreviewProps) {
  const totalPagesCount = 1 + appMap.discoveredLinks.length;
  const maxReached = selectedUrls.length >= 5;
  const canDeepCrawl =
    onToggleDeepCrawl !== undefined &&
    selectedUrls.length === 1 &&
    appMap.discoveredLinks.length > 0;

  const eligibleFields = useMemo(() => {
    return appMap.elements
      .filter((el) => {
        if (el.page !== undefined && el.page > 1) return false;
        if (el.isVisible === false) return false;
        if (el.isReadOnly) return false;
        if (!['input', 'textarea', 'select'].includes(el.type)) return false;
        if (el.inputType && EXCLUDED_INPUT_TYPES.has(el.inputType.toLowerCase())) return false;
        return true;
      })
      .slice(0, 30);
  }, [appMap.elements]);

  const hasLoginOrSignup = useMemo(() => {
    return (appMap.forms ?? []).some(
      (f) => f.purpose === 'login' || f.purpose === 'signup',
    );
  }, [appMap.forms]);

  const [isTestDataExpanded, setIsTestDataExpanded] = useState<boolean>(() => hasLoginOrSignup);

  const groupedFields = useMemo(() => {
    const groups: Array<{ id: string; title: string; fields: InteractiveElement[] }> = [];
    const assigned = new Set<string>();

    for (const form of appMap.forms ?? []) {
      const fields = eligibleFields.filter((f) => form.fieldIds.includes(f.id));
      if (fields.length > 0) {
        fields.forEach((f) => assigned.add(f.id));
        const title =
          form.purpose === 'login'
            ? 'Login form'
            : form.purpose === 'signup'
              ? 'Sign-up form'
              : form.purpose === 'search'
                ? 'Search'
                : 'Form';
        groups.push({ id: form.id, title, fields });
      }
    }

    const otherFields = eligibleFields.filter((f) => !assigned.has(f.id));
    if (otherFields.length > 0) {
      groups.push({ id: 'other', title: 'Other inputs', fields: otherFields });
    }

    return groups;
  }, [appMap.forms, eligibleFields]);

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

      {/* Test Data Section */}
      {eligibleFields.length > 0 && (
        <div style={{ marginTop: '20px', border: '1px solid #e0e5de', borderRadius: '10px', background: '#fff', overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setIsTestDataExpanded(!isTestDataExpanded)}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              background: '#f8faf7',
              border: 'none',
              borderBottom: isTestDataExpanded ? '1px solid #e0e5de' : 'none',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              color: '#243027',
            }}
          >
            <span>Test data · {eligibleFields.length} fields · optional</span>
            <span style={{ fontSize: '11px', color: '#7a857e' }}>{isTestDataExpanded ? '▲ Collapse' : '▼ Expand'}</span>
          </button>

          {isTestDataExpanded && (
            <div style={{ padding: '16px' }}>
              {hasLoginOrSignup && (
                <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', color: '#92400e', marginBottom: '16px' }}>
                  Provide test credentials, or leave blank (login tests will likely fail).
                </div>
              )}

              {groupedFields.map((group) => (
                <div key={group.id} style={{ marginBottom: '16px' }}>
                  <h4 style={{ fontSize: '11px', fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                    {group.title}
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {group.fields.map((field) => {
                      const label = field.ariaLabel || field.placeholder || field.name || field.text || field.id;
                      const entry = testData[field.id] ?? {
                        value: '',
                        sensitive: field.inputType === 'password',
                      };
                      return (
                        <div key={field.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: '8px', alignItems: 'center' }}>
                          <label htmlFor={`td-${field.id}`} style={{ fontSize: '12px', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>
                            {label}
                          </label>
                          <input
                            id={`td-${field.id}`}
                            type={entry.sensitive ? 'password' : 'text'}
                            value={entry.value}
                            placeholder={field.placeholder || 'Value...'}
                            onChange={(e) => onUpdateTestData(field.id, e.target.value, entry.sensitive)}
                            disabled={generating || disabled}
                            style={{
                              padding: '6px 10px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '12px',
                              width: '100%',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => onUpdateTestData(field.id, entry.value, !entry.sensitive)}
                            disabled={generating || disabled}
                            title={entry.sensitive ? 'Marked as Secret (never sent to AI, never stored)' : 'Plain text'}
                            style={{
                              padding: '5px 8px',
                              fontSize: '11px',
                              fontWeight: 600,
                              borderRadius: '6px',
                              border: entry.sensitive ? '1px solid #dc2626' : '1px solid #d1d5db',
                              background: entry.sensitive ? '#fef2f2' : '#f9fafb',
                              color: entry.sensitive ? '#b91c1c' : '#6b7280',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            {entry.sensitive ? (
                              <>
                                <Lock aria-hidden="true" className="h-3 w-3" /> Secret
                              </>
                            ) : (
                              <>
                                <LockOpen aria-hidden="true" className="h-3 w-3" /> Plain
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <p style={{ fontSize: '11px', color: '#6b7280', margin: '8px 0 0 0', lineHeight: 1.4 }}>
                Use test accounts only. Secret values are used only while tests run — never sent to the AI, never stored, redacted from results. Exported code reads them from env vars.
              </p>
            </div>
          )}
        </div>
      )}

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
