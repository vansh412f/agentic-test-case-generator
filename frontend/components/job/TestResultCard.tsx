import { CaretRight, Check, CircleNotch, PencilSimple, Warning } from '@phosphor-icons/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CodeViewer } from '@/components/code/CodeViewer';
import { DiffViewer } from '@/components/code/DiffViewer';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useBackendMode } from '@/hooks/useBackendMode';
import { ApiError, apiBase, getTraceLinks, rerunTest } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { PersistedGeneratedTest, PlannedTestCase } from '@/types/api';

const RERUN_POLL_INTERVAL_MS = 2_000;
const RERUN_POLL_TIMEOUT_MS = 240_000;

interface TestResultCardProps {
  test: PersistedGeneratedTest;
  plannedCase?: PlannedTestCase;
  jobId: string;
  canEdit: boolean;
  /** Refetches the job detail so the in-flight attempt can be observed. */
  onRefresh: () => void;
}

export const TestResultCard = React.memo(function TestResultCard({
  test,
  plannedCase,
  jobId,
  canEdit,
  onRefresh,
}: TestResultCardProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'code' | 'diff' | 'error'>('code');
  const { isLocal } = useBackendMode();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(test.finalCode);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [headed, setHeaded] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [pendingAttempt, setPendingAttempt] = useState<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timeoutTimerRef.current !== null) {
      window.clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startEditing = () => {
    setDraft(test.finalCode);
    setSecretValues({});
    setEditing(true);
    setOpen(true);
    setTab('code');
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft(test.finalCode);
    setSecretValues({});
  };

  const resetDraft = () => {
    setDraft(test.finalCode);
    setSecretValues({});
  };

  const handleRerun = async () => {
    if (rerunning) return;
    const providedSecrets = Object.fromEntries(
      Object.entries(secretValues).filter(([, value]) => value.length > 0),
    );

    setRerunning(true);
    try {
      const { attemptNumber } = await rerunTest(jobId, test.testCaseId, {
        code: draft,
        ...(headed && isLocal ? { headed: true } : {}),
        ...(Object.keys(providedSecrets).length > 0 ? { secrets: providedSecrets } : {}),
      });
      setPendingAttempt(attemptNumber);
      onRefresh();
      pollTimerRef.current = window.setInterval(onRefresh, RERUN_POLL_INTERVAL_MS);
      timeoutTimerRef.current = window.setTimeout(() => {
        stopPolling();
        setRerunning(false);
        setPendingAttempt(null);
        toast.error('Re-run is taking longer than expected. Refresh to check the result.');
      }, RERUN_POLL_TIMEOUT_MS);
    } catch (error) {
      setRerunning(false);
      setPendingAttempt(null);
      if (error instanceof ApiError && error.code === 'RERUN_IN_PROGRESS') {
        toast.error('This test is already being re-run.');
      } else if (error instanceof ApiError && error.status === 429) {
        toast.error('Daily re-run limit reached. It resets at midnight UTC.');
      } else if (error instanceof ApiError && error.status === 404) {
        toast.error("This job can't be edited from this browser.");
      } else if (error instanceof ApiError && error.code === 'TEST_DATA_REQUIRED') {
        toast.error('Test data needed — enter values for the protected fields to run this test.');
      } else {
        toast.error('Could not start the re-run. Try again.');
      }
    } finally {
      // Secret values live in component state only and are never kept around.
      setSecretValues({});
    }
  };

  const isFailed = test.finalStatus === 'failed';
  const isGaveUp = test.finalStatus === 'gave_up';
  const isNeedsReview = test.finalStatus === 'needs_review';
  const isCorrected = test.executionResults.some((r) => r.corrected);
  const originalAttempt = test.executionResults.find((r) => r.attemptNumber === 1);
  const lastFailedAttempt = [...test.executionResults]
    .reverse()
    .find((r) => r.executionError || r.validationErrors);
  const lastAttempt = [...test.executionResults]
    .sort((a, b) => a.attemptNumber - b.attemptNumber)
    .pop();
  const lastAttemptIsRerun =
    (lastAttempt?.failureContext as { source?: unknown } | null | undefined)?.source === 'rerun';
  const lastValidationErrors: string[] = Array.isArray(lastAttempt?.validationErrors)
    ? (lastAttempt.validationErrors as unknown[]).filter(
        (item): item is string => typeof item === 'string',
      )
    : [];
  const isBaseline =
    plannedCase?.origin === 'baseline' || test.testCaseId.startsWith('smoke-');
  const editable = canEdit && !isBaseline;
  const secretTokens = useMemo(
    () => Array.from(new Set(draft.match(/__AGT_SECRET_\d+__/g) ?? [])),
    [draft],
  );
  const missingSecretTokens = secretTokens.filter(
    (token) => !(secretValues[token]?.length),
  );
  const testDataMissing = editing && missingSecretTokens.length > 0;

  // Stop polling as soon as the refreshed job shows the new attempt.
  useEffect(() => {
    if (pendingAttempt === null) return;
    if (test.totalAttempts < pendingAttempt) return;

    stopPolling();
    setPendingAttempt(null);
    setRerunning(false);
    setEditing(false);
    setSecretValues({});

    const latest = [...test.executionResults]
      .sort((a, b) => a.attemptNumber - b.attemptNumber)
      .pop();
    if (latest?.validationPassed === false) {
      toast.error("Code didn't validate — see details below");
    } else if (latest?.executionPassed) {
      toast.success('Test passed on re-run');
    } else {
      toast.error('Test failed on re-run');
    }
  }, [pendingAttempt, test.totalAttempts, test.executionResults, stopPolling]);

  // Auto-corrections and user edits both produce "original vs current" code.
  const hasDiff =
    (isCorrected || lastAttemptIsRerun) &&
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
            {isBaseline ? (
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
            {lastAttemptIsRerun ? (
              <span
                style={{
                  color: '#92400e',
                  background: '#fef3c7',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  fontSize: '10px',
                  fontWeight: 600,
                  marginLeft: '6px',
                }}
              >
                Edited
              </span>
            ) : null}
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
              {editable ? (
                <div
                  className="flex flex-wrap items-center justify-end gap-2 px-3 py-2"
                  style={{ borderBottom: '1px solid #e5e7eb', background: '#fbfcfb' }}
                >
                  {editing ? (
                    <>
                      <button
                        className="primary-button"
                        disabled={rerunning || testDataMissing}
                        onClick={() => void handleRerun()}
                        type="button"
                      >
                        {rerunning ? (
                          <>
                            <CircleNotch aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />{' '}
                            Running…
                          </>
                        ) : (
                          'Run test'
                        )}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={rerunning}
                        onClick={resetDraft}
                        type="button"
                      >
                        Reset
                      </button>
                      <button
                        className="secondary-button"
                        disabled={rerunning}
                        onClick={cancelEditing}
                        type="button"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="secondary-button" onClick={startEditing} type="button">
                      <PencilSimple aria-hidden="true" className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                </div>
              ) : null}

              {editing && secretTokens.length > 0 ? (
                <div
                  style={{
                    padding: '8px 12px',
                    background: '#f9fafb',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '11px', color: '#6b7280' }}>
                    This test uses protected values from the original run. Re-enter them to run —
                    they&apos;re sent once for this run and never stored.
                  </p>
                  {secretTokens.map((token) => (
                    <label
                      key={token}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}
                    >
                      <span style={{ fontFamily: 'monospace', color: '#374151', minWidth: '140px' }}>
                        {token}
                      </span>
                      <input
                        aria-label={token}
                        autoComplete="off"
                        disabled={rerunning}
                        onChange={(event) =>
                          setSecretValues((previous) => ({
                            ...previous,
                            [token]: event.target.value,
                          }))
                        }
                        style={{
                          border: '1px solid #d1d5db',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          fontSize: '12px',
                          width: '220px',
                        }}
                        type="password"
                        value={secretValues[token] ?? ''}
                      />
                    </label>
                  ))}
                  {testDataMissing && (
                    <p role="note" style={{ margin: 0, fontSize: '11px', color: '#92400e' }}>
                      Test data needed — enter values for the protected fields to run this test.
                    </p>
                  )}
                </div>
              ) : null}

              {editing && isLocal ? (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    color: '#374151',
                    borderBottom: '1px solid #e5e7eb',
                  }}
                >
                  <input
                    checked={headed}
                    disabled={rerunning}
                    onChange={(event) => setHeaded(event.target.checked)}
                    type="checkbox"
                  />
                  Show browser
                </label>
              ) : null}

              {test.finalCode.includes('__AGT_SECRET_') && !editing && (
                <div style={{ padding: '6px 12px', fontSize: '11px', color: '#6b7280', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  Secret values were injected at run time and are not stored.
                </div>
              )}
              <CodeViewer
                code={editing ? draft : test.finalCode}
                editable={editing}
                filename={test.filename}
                highlightLine={editing ? undefined : fs?.line}
                onChange={setDraft}
              />
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
              {lastAttempt?.validationPassed === false && lastValidationErrors.length > 0 && (
                <div style={{ margin: '8px 0 12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#b91c1c', marginBottom: '4px' }}>
                    Code validation
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#7f1d1d' }}>
                    {lastValidationErrors.map((message, index) => (
                      <li key={`${index}-${message}`} style={{ marginBottom: '2px' }}>
                        <code>{message}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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

          {/* Trace buttons for the last attempt */}
          {lastAttempt?.traceExpiresAt && Date.parse(lastAttempt.traceExpiresAt) > Date.now() && (
            <div style={{ marginTop: '12px', padding: '8px 0', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
              <p style={{ margin: '4px 0', fontSize: '11px', color: '#6b7280' }}>
                Trace includes page snapshots and everything typed during the test. Available for one hour. Expires {new Date(lastAttempt.traceExpiresAt).toLocaleTimeString()}.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button
                  className="secondary-button"
                  onClick={() => {
                    getTraceLinks(jobId, test.testCaseId, lastAttempt.attemptNumber)
                      .then((links) => {
                        window.open(`${apiBase()}${links.viewerPath}`, '_blank', 'noopener');
                      })
                      .catch((err) => {
                        if (err.code === 'TRACE_NOT_FOUND') {
                          toast.error('This trace has expired. Re-run the test to capture a new one.');
                          onRefresh();
                        } else {
                          toast.error('Could not open trace.');
                        }
                      });
                  }}
                  disabled={rerunning}
                  type="button"
                >
                  Open trace
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    getTraceLinks(jobId, test.testCaseId, lastAttempt.attemptNumber)
                      .then((links) => {
                        const downloadUrl = `${apiBase()}${links.downloadPath}`;
                        const anchor = document.createElement('a');
                        anchor.href = downloadUrl;
                        anchor.download = `trace-${test.testCaseId}-attempt-${lastAttempt.attemptNumber}.zip`;
                        anchor.click();
                      })
                      .catch((err) => {
                        if (err.code === 'TRACE_NOT_FOUND') {
                          toast.error('This trace has expired. Re-run the test to capture a new one.');
                          onRefresh();
                        } else {
                          toast.error('Could not download trace.');
                        }
                      });
                  }}
                  disabled={rerunning}
                  type="button"
                >
                  Download trace
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
});
