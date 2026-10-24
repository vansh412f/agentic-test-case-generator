import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  DownloadSimple,
  FilmStrip,
  WarningCircle,
} from '@phosphor-icons/react';
import { getTraceLinks, ApiError } from '@/lib/api';
import type { JobDetail, ExecutionResult } from '@/types/api';
import { formatDurationMs } from '@/lib/utils';

export interface ReplayItem {
  testCaseId: string;
  testTitle: string;
  filename: string;
  attemptNumber: number;
  passed: boolean;
  durationMs: number;
  error?: string | null;
  failureSummary?: ExecutionResult['failureSummary'];
  traceExpiresAt?: string;
  hasLiveTrace: boolean;
}

interface ReplayPanelProps {
  job: JobDetail;
  selectedTestCaseId?: string;
  selectedAttemptNumber?: number;
  onSelectAttempt?: (testCaseId: string, attemptNumber: number) => void;
  onRefresh?: () => void;
}

export function ReplayPanel({
  job,
  selectedTestCaseId,
  selectedAttemptNumber,
  onSelectAttempt,
  onRefresh,
}: ReplayPanelProps) {
  // Collect all attempts from generatedTests
  const items: ReplayItem[] = useMemo(() => {
    const list: ReplayItem[] = [];
    const now = Date.now();

    for (const test of job.generatedTests) {
      const planned = job.testPlan?.testCases.find((tc) => tc.id === test.testCaseId);
      const testTitle = planned?.title || test.testCaseId;

      for (const att of test.executionResults) {
        const hasLiveTrace = Boolean(
          att.traceExpiresAt && Date.parse(att.traceExpiresAt) > now,
        );

        // Include any attempt that has traceExpiresAt (live or expired)
        if (att.traceExpiresAt) {
          list.push({
            testCaseId: test.testCaseId,
            testTitle,
            filename: test.filename,
            attemptNumber: att.attemptNumber,
            passed: Boolean(att.executionPassed),
            durationMs: att.durationMs ?? 0,
            error: att.executionError,
            failureSummary: att.failureSummary,
            traceExpiresAt: att.traceExpiresAt,
            hasLiveTrace,
          });
        }
      }
    }

    // Sort: live traces first, then by testCaseId and attemptNumber
    return list.sort((a, b) => {
      if (a.hasLiveTrace !== b.hasLiveTrace) {
        return a.hasLiveTrace ? -1 : 1;
      }
      if (a.testCaseId !== b.testCaseId) {
        return a.testCaseId.localeCompare(b.testCaseId);
      }
      return a.attemptNumber - b.attemptNumber;
    });
  }, [job]);

  // Determine current active item
  const activeItem = useMemo(() => {
    if (items.length === 0) return null;
    if (selectedTestCaseId && typeof selectedAttemptNumber === 'number') {
      const match = items.find(
        (i) =>
          i.testCaseId === selectedTestCaseId &&
          i.attemptNumber === selectedAttemptNumber,
      );
      if (match) return match;
    }
    // Default to the first live trace, or the first item
    return items.find((i) => i.hasLiveTrace) ?? items[0];
  }, [items, selectedTestCaseId, selectedAttemptNumber]);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [traceLinks, setTraceLinks] = useState<{
    traceId: string;
    expiresAt: string;
    downloadPath: string;
    viewerPath: string;
  } | null>(null);

  const fetchLinks = useCallback(async (item: ReplayItem) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const links = await getTraceLinks(job.id, item.testCaseId, item.attemptNumber);
      setTraceLinks(links);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TRACE_NOT_FOUND') {
        setErrorMsg('This trace has expired. Traces are kept for 1 hour after execution.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Could not load trace replay.');
      }
      setTraceLinks(null);
    } finally {
      setLoading(false);
    }
  }, [job.id]);

  useEffect(() => {
    if (activeItem) {
      void fetchLinks(activeItem);
    } else {
      setTraceLinks(null);
    }
  }, [activeItem, fetchLinks]);

  const handleSelect = (item: ReplayItem) => {
    if (onSelectAttempt) {
      onSelectAttempt(item.testCaseId, item.attemptNumber);
    }
  };

  if (items.length === 0) {
    return (
      <div className="replay-empty-card">
        <FilmStrip className="h-10 w-10 text-gray-400 mb-3" />
        <h3 className="text-base font-bold text-gray-800">No replay traces available</h3>
        <p className="text-xs text-gray-500 max-w-md mt-1 text-center">
          Traces are automatically captured on every test execution attempt and kept for 1 hour.
          If this job is still running or traces have expired, they will appear here once executed.
        </p>
      </div>
    );
  }

  return (
    <div className="replay-panel-root">
      {/* Sidebar: Attempt list */}
      <aside className="replay-sidebar">
        <div className="replay-sidebar-header">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Execution Attempts ({items.length})
          </span>
        </div>

        <div className="replay-items-list">
          {items.map((item) => {
            const isSelected =
              activeItem?.testCaseId === item.testCaseId &&
              activeItem?.attemptNumber === item.attemptNumber;

            return (
              <button
                key={`${item.testCaseId}-att-${item.attemptNumber}`}
                type="button"
                onClick={() => handleSelect(item)}
                className={`replay-item-btn ${isSelected ? 'is-selected' : ''}`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="replay-item-tc-id">{item.testCaseId}</span>
                  <span
                    className={`replay-item-badge ${
                      item.passed ? 'badge-passed' : 'badge-failed'
                    }`}
                  >
                    {item.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
                <div className="replay-item-title" title={item.testTitle}>
                  {item.testTitle}
                </div>
                <div className="replay-item-footer">
                  <span>Attempt {item.attemptNumber}</span>
                  <span>{formatDurationMs(item.durationMs)}</span>
                  {!item.hasLiveTrace && (
                    <span className="text-red-500 font-medium">Expired</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main viewer panel */}
      <section className="replay-main-viewer">
        {activeItem && (
          <header className="replay-viewer-toolbar">
            <div className="replay-viewer-meta">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-gray-900">
                  {activeItem.testCaseId} (Attempt {activeItem.attemptNumber})
                </span>
                <span
                  className={`replay-item-badge ${
                    activeItem.passed ? 'badge-passed' : 'badge-failed'
                  }`}
                >
                  {activeItem.passed ? 'Passed' : 'Failed'}
                </span>
              </div>
              <span className="text-xs text-gray-500 truncate max-w-sm">
                {activeItem.testTitle}
              </span>
            </div>

            <div className="replay-viewer-actions">
              <button
                type="button"
                className="secondary-button text-xs py-1 px-2.5 flex items-center gap-1.5"
                onClick={() => {
                  if (activeItem) void fetchLinks(activeItem);
                  onRefresh?.();
                }}
                title="Refresh trace"
              >
                <ArrowCounterClockwise className="h-3.5 w-3.5" />
                <span>Refresh</span>
              </button>

              {traceLinks && (
                <>
                  <a
                    href={traceLinks.downloadPath}
                    download={`trace-${activeItem.testCaseId}-attempt-${activeItem.attemptNumber}.zip`}
                    className="secondary-button text-xs py-1 px-2.5 flex items-center gap-1.5"
                    title="Download raw trace zip"
                  >
                    <DownloadSimple className="h-3.5 w-3.5" />
                    <span>Download</span>
                  </a>

                  <a
                    href={traceLinks.viewerPath}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="secondary-button text-xs py-1 px-2.5 flex items-center gap-1.5"
                    title="Open Playwright trace viewer in new window"
                  >
                    <ArrowSquareOut className="h-3.5 w-3.5" />
                    <span>Open full screen</span>
                  </a>
                </>
              )}
            </div>
          </header>
        )}

        <div className="replay-frame-container">
          {loading && (
            <div className="replay-loading-state">
              <div className="animate-spin h-6 w-6 border-2 border-indigo-600 border-t-transparent rounded-full mb-2" />
              <p className="text-xs text-gray-500">Loading trace viewer…</p>
            </div>
          )}

          {!loading && errorMsg && (
            <div className="replay-error-state">
              <WarningCircle className="h-8 w-8 text-amber-500 mb-2" />
              <h4 className="text-sm font-semibold text-gray-800">Trace Replay Unavailable</h4>
              <p className="text-xs text-gray-500 max-w-sm text-center mt-1">{errorMsg}</p>
            </div>
          )}

          {!loading && !errorMsg && traceLinks && (
            <iframe
              src={traceLinks.viewerPath}
              title={`Trace viewer for ${activeItem?.testCaseId}`}
              className="replay-iframe"
            />
          )}
        </div>

        <footer className="replay-privacy-notice">
          <span>
            🔒 <strong>Privacy note:</strong> Traces record DOM snapshots, console logs, network actions, and input values during execution. Available to run owner for 1 hour after execution.
          </span>
        </footer>
      </section>
    </div>
  );
}
