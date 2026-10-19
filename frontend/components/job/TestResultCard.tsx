import { CaretRight, Check, Warning } from '@phosphor-icons/react';
import React, { useState } from 'react';
import { CodeViewer } from '@/components/code/CodeViewer';
import { DiffViewer } from '@/components/code/DiffViewer';
import { StatusBadge } from '@/components/common/StatusBadge';
import { cn } from '@/lib/utils';
import type { PersistedGeneratedTest, PlannedTestCase } from '@/types/api';

interface TestResultCardProps {
  test: PersistedGeneratedTest;
  plannedCase?: PlannedTestCase;
}

export const TestResultCard = React.memo(function TestResultCard({ test, plannedCase }: TestResultCardProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'code' | 'diff' | 'error'>('code');

  const isFailed = test.finalStatus === 'failed';
  const isGaveUp = test.finalStatus === 'gave_up';
  const isNeedsReview = test.finalStatus === 'needs_review';
  const isCorrected = test.executionResults.some((r) => r.corrected);
  const originalAttempt = test.executionResults.find((r) => r.attemptNumber === 1);
  const lastFailedAttempt = [...test.executionResults]
    .reverse()
    .find((r) => r.executionError || r.validationErrors);

  const hasDiff =
    isCorrected &&
    originalAttempt !== undefined &&
    originalAttempt.code !== test.finalCode;
  const hasError =
    isFailed ||
    isNeedsReview ||
    test.executionResults.some((r) => r.validationPassed === false) ||
    Boolean(lastFailedAttempt?.executionError) ||
    isGaveUp;

  const title = plannedCase?.title ?? test.filename;
  const failureCategory =
    lastFailedAttempt?.failureClass ??
    (lastFailedAttempt?.validationErrors ? 'VALIDATION' : isFailed ? 'finding' : isGaveUp ? 'gave_up' : isNeedsReview ? 'needs_review' : null);

  const errorString =
    lastFailedAttempt?.executionError ??
    (typeof lastFailedAttempt?.validationErrors === 'string'
      ? lastFailedAttempt.validationErrors
      : lastFailedAttempt?.validationErrors
        ? JSON.stringify(lastFailedAttempt.validationErrors, null, 2)
        : 'Assertion or locator failure encountered during execution.');

  const fc = (test.failureContext ?? lastFailedAttempt?.failureContext) as
    | { finalUrl?: string; canonicalUrl?: string }
    | undefined;
  let finalPath = 'another page';
  if (fc?.finalUrl) {
    try {
      const u = new URL(fc.finalUrl);
      finalPath = u.pathname + (u.hash && u.hash.startsWith('#/') ? u.hash : '');
    } catch {
      finalPath = fc.finalUrl;
    }
  }

  const fs = (test.failureSummary ?? lastFailedAttempt?.failureSummary) as
    | {
        kind?: string;
        headline?: string;
        expected?: string;
        received?: string;
        target?: string;
        line?: number;
        codeFrame?: string;
      }
    | undefined;
  const target = fs?.target ?? 'an element';

  return (
    <article className="test-case">
      <button
        aria-expanded={open}
        className="test-summary"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <CaretRight
          aria-hidden="true"
          className={cn('chev h-4 w-4 shrink-0', open && 'rotated')}
        />
        <span
          className={cn(
            'test-status-icon shrink-0',
            isFailed && 'failed',
            isGaveUp && 'gave-up',
            isNeedsReview && 'needs-review',
          )}
        >
          {isFailed ? (
            '!'
          ) : isGaveUp ? (
            <Warning aria-hidden="true" className="h-3.5 w-3.5" />
          ) : isNeedsReview ? (
            '?'
          ) : (
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="test-name">
          <strong>
            {title}
            {plannedCase?.origin === 'baseline' || test.testCaseId.startsWith('smoke-') ? (
              <span
                style={{
                  color: '#0369a1',
                  background: '#e0f2fe',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  marginLeft: '8px',
                }}
              >
                Built-in check
              </span>
            ) : (
              <span
                style={{
                  color: '#4f46e5',
                  background: '#eef2ff',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  marginLeft: '8px',
                }}
              >
                Generated scenario
              </span>
            )}
          </strong>
          {isNeedsReview && (
            <div
              style={{
                marginTop: '4px',
                padding: '4px 8px',
                background: '#f3f4f6',
                border: '1px solid #e5e7eb',
                borderRadius: '4px',
                color: '#4b5563',
                fontSize: '11px',
                lineHeight: '1.4',
              }}
            >
              The page moved to <strong>{finalPath}</strong> before this check ran. It looks for <strong>{target}</strong> from the previous page, so the expectation is likely wrong, not your site.
            </div>
          )}
          <small>
            {test.totalAttempts} {test.totalAttempts === 1 ? 'attempt' : 'attempts'}
            {isCorrected ? ' · auto-corrected' : ''}
            {test.confidence?.score !== undefined ? ` · ${test.confidence.score}% confidence` : ''}
          </small>
        </span>
        <StatusBadge status={test.finalStatus} />
      </button>

      {open && (
        <div className="test-details">
          <div className="detail-tabs">
            <button
              className={tab === 'code' ? 'active' : ''}
              onClick={() => setTab('code')}
              type="button"
            >
              Test code
            </button>
            {hasDiff ? (
              <button
                className={tab === 'diff' ? 'active' : ''}
                onClick={() => setTab('diff')}
                type="button"
              >
                Correction diff
              </button>
            ) : null}
            {hasError ? (
              <button
                className={tab === 'error' ? 'active' : ''}
                onClick={() => setTab('error')}
                type="button"
              >
                Error output
              </button>
            ) : null}
          </div>

          {tab === 'code' ? (
            <>
              {test.finalCode.includes('__AGT_SECRET_') && (
                <div style={{ padding: '6px 12px', fontSize: '11px', color: '#6b7280', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  Secret values were injected at run time and are not stored.
                </div>
              )}
              <CodeViewer code={test.finalCode} filename={test.filename} highlightLine={fs?.line} />
            </>
          ) : null}

          {tab === 'diff' && hasDiff && originalAttempt ? (
            <DiffViewer
              modified={test.finalCode}
              original={originalAttempt.code}
            />
          ) : null}

          {tab === 'error' && (
            <div className="error-output">
              {fs?.headline && (
                <div style={{ margin: '8px 0', fontSize: '13px', fontWeight: 600, color: '#b91c1c' }}>
                  {fs.headline}
                </div>
              )}
              {(fs?.expected || fs?.received) && (
                <div style={{ margin: '6px 0', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {fs.expected && (
                    <div>
                      <span style={{ fontWeight: 600, color: '#047857' }}>Expected: </span>
                      <code style={{ background: '#f0fdf4', padding: '1px 4px', borderRadius: '3px', color: '#065f46' }}>{fs.expected}</code>
                    </div>
                  )}
                  {fs.received && (
                    <div>
                      <span style={{ fontWeight: 600, color: '#b91c1c' }}>Received: </span>
                      <code style={{ background: '#fef2f2', padding: '1px 4px', borderRadius: '3px', color: '#991b1b' }}>{fs.received}</code>
                    </div>
                  )}
                </div>
              )}
              {(fs?.codeFrame || fs?.line) && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                    Failing line{fs?.line ? ` (${fs.line})` : ''}:
                  </div>
                  {fs?.codeFrame ? (
                    <pre style={{ margin: 0, padding: '8px 12px', background: '#161c18', color: '#f8fafc', borderRadius: '6px', overflow: 'auto', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre' }}>
                      {fs.codeFrame}
                    </pre>
                  ) : (
                    <pre style={{ margin: 0, padding: '8px 12px', background: '#161c18', color: '#f8fafc', borderRadius: '6px', overflow: 'auto', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre' }}>
                      {test.finalCode.split('\n')[fs!.line! - 1] ?? ''}
                    </pre>
                  )}
                </div>
              )}
              <details style={{ marginTop: '12px', fontSize: '11px', color: '#6b7280' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Technical details</summary>
                <pre style={{ marginTop: '6px', padding: '10px', background: '#161c18', color: '#b8c4bc', borderRadius: '6px', overflow: 'auto', maxHeight: '200px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '11px' }}>
                  {errorString}
                </pre>
              </details>
              <p style={{ marginTop: '10px' }}>
                {isNeedsReview ? (
                  <>
                    The page moved to <strong>{finalPath}</strong> before this check ran. It looks for{' '}
                    <strong>{target}</strong> from the previous page, so the expectation is likely wrong, not your site.
                  </>
                ) : failureCategory === 'finding' ? (
                  'This check failed against your site. Review it — it may be a real bug or a wrong expectation.'
                ) : (
                  'Mechanical failure encountered during execution and retry attempts.'
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
});
