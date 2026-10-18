import { CaretRight, Check } from '@phosphor-icons/react';
import { useState } from 'react';
import { CodeViewer } from '@/components/code/CodeViewer';
import { DiffViewer } from '@/components/code/DiffViewer';
import { StatusBadge } from '@/components/common/StatusBadge';
import { cn } from '@/lib/utils';
import type { PersistedGeneratedTest, PlannedTestCase } from '@/types/api';

interface TestResultCardProps {
  test: PersistedGeneratedTest;
  plannedCase?: PlannedTestCase;
}

export function TestResultCard({ test, plannedCase }: TestResultCardProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'code' | 'diff' | 'error'>('code');

  const isFailed = test.finalStatus === 'failed';
  const isCorrected = test.executionResults.some((r) => r.corrected);
  const originalAttempt = test.executionResults.find((r) => r.attemptNumber === 1);
  const lastFailedAttempt = [...test.executionResults]
    .reverse()
    .find((r) => r.executionError || r.validationErrors);

  const hasDiff =
    isCorrected &&
    originalAttempt !== undefined &&
    originalAttempt.code !== test.finalCode;
  const hasError = isFailed || Boolean(lastFailedAttempt?.executionError);

  const title = plannedCase?.title ?? test.filename;
  const failureCategory =
    lastFailedAttempt?.failureClass ?? (isFailed ? 'finding' : null);

  const errorString =
    lastFailedAttempt?.executionError ??
    (typeof lastFailedAttempt?.validationErrors === 'string'
      ? lastFailedAttempt.validationErrors
      : lastFailedAttempt?.validationErrors
        ? JSON.stringify(lastFailedAttempt.validationErrors, null, 2)
        : 'Assertion or locator failure encountered during execution.');

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
        <span className={cn('test-status-icon shrink-0', isFailed && 'failed')}>
          {isFailed ? '!' : <Check aria-hidden="true" className="h-3.5 w-3.5" />}
        </span>
        <span className="test-name">
          <strong>{title}</strong>
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
              <CodeViewer code={test.finalCode} filename={test.filename} />
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
              <span>
                FAILURE CATEGORY · <b>{failureCategory?.toUpperCase() ?? 'FINDING'}</b>
              </span>
              <code>{errorString}</code>
              <p>
                {failureCategory === 'finding'
                  ? 'Assertion preserved. This appears to be a real application defect and was not auto-corrected.'
                  : 'Mechanical failure encountered during execution and retry attempts.'}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
