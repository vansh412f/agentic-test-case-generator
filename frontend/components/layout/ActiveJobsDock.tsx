import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { readActiveJobs, subscribe, untrackJob, type ActiveJobItem } from '@/lib/activeJobs';
import { getJob, ApiError } from '@/lib/api';
import { computePipelineProgress } from '@/lib/pipelineProgress';
import { isTerminalJobStatus } from '@/lib/utils';
import type { JobDetail } from '@/types/api';

interface JobProgressInfo {
  job?: JobDetail;
  percent: number;
  actionTitle: string;
}

function formatUrlSnippet(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    const combined = `${host}${path}`;
    if (combined.length <= 28) return combined;
    return combined.slice(0, 14) + '…' + combined.slice(-12);
  } catch {
    return urlStr.slice(0, 26);
  }
}

export function ActiveJobsDock() {
  const router = useRouter();
  const [items, setItems] = useState<ActiveJobItem[]>([]);
  const [jobsState, setJobsState] = useState<Record<string, JobProgressInfo>>({});
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    setItems(readActiveJobs());
    return subscribe((updated) => {
      setItems(updated);
    });
  }, []);

  useEffect(() => {
    const mostRecent = [...items].sort((a, b) => b.addedAt - a.addedAt).slice(0, 3);
    if (mostRecent.length === 0) return;

    let cancelled = false;

    async function poll() {
      if (document.hidden || cancelled) return;

      await Promise.all(
        mostRecent.map(async (entry) => {
          try {
            const job = await getJob(entry.id);
            if (cancelled) return;

            if (isTerminalJobStatus(job.status)) {
              untrackJob(entry.id);
              const isOnPage =
                router.asPath === `/jobs/${entry.id}` ||
                router.asPath.startsWith(`/jobs/${entry.id}?`);

              if (!isOnPage) {
                const passed = job.generatedTests.filter((t) => t.finalStatus === 'passed').length;
                const total = job.generatedTests.length;
                toast.success(`Run finished · ${passed}/${total} passed`, {
                  action: {
                    label: 'View',
                    onClick: () => void router.push(`/jobs/${entry.id}`),
                  },
                });
              }
            } else {
              const progress = computePipelineProgress(job);
              setJobsState((prev) => ({
                ...prev,
                [entry.id]: {
                  job,
                  percent: progress.percent,
                  actionTitle: progress.actionTitle,
                },
              }));
            }
          } catch (err) {
            if (cancelled) return;
            if (err instanceof ApiError && err.status === 404) {
              untrackJob(entry.id);
            }
          }
        }),
      );
    }

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [items, router]);

  const visibleEntries = [...items]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 3)
    .filter((entry) => {
      const isOnPage =
        router.asPath === `/jobs/${entry.id}` ||
        router.asPath.startsWith(`/jobs/${entry.id}?`);
      return !isOnPage;
    });

  if (visibleEntries.length === 0) {
    return null;
  }

  return (
    <aside
      aria-label="Running test generation jobs"
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: 40,
        width: '320px',
        background: '#ffffff',
        border: '1px solid #e0e5de',
        borderRadius: '12px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden',
        fontFamily: 'inherit',
      }}
    >
      <div
        onClick={() => setIsCollapsed((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: '#f8faf7',
          borderBottom: isCollapsed ? 'none' : '1px solid #e0e5de',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#243027' }}>
          {visibleEntries.length} {visibleEntries.length === 1 ? 'running' : 'running'}
        </span>
        <button
          type="button"
          aria-label={isCollapsed ? 'Expand running jobs dock' : 'Collapse running jobs dock'}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: '#7a857e',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {isCollapsed ? <CaretUp size={14} /> : <CaretDown size={14} />}
        </button>
      </div>

      {!isCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {visibleEntries.map((entry) => {
            const state = jobsState[entry.id];
            const percent = state?.percent ?? 0;
            const actionTitle = state?.actionTitle ?? 'Starting…';

            return (
              <Link
                key={entry.id}
                href={`/jobs/${entry.id}`}
                style={{
                  display: 'block',
                  padding: '10px 14px',
                  textDecoration: 'none',
                  color: 'inherit',
                  borderBottom: '1px solid #f1f4f0',
                  position: 'relative',
                  transition: 'background 0.15s ease',
                }}
                className="hover:bg-slate-50"
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#10b981',
                        flexShrink: 0,
                      }}
                    />
                    <strong
                      style={{
                        fontSize: '12px',
                        color: '#111827',
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={entry.url}
                    >
                      {formatUrlSnippet(entry.url)}
                    </strong>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#4b5563', flexShrink: 0 }}>
                    {percent}%
                  </span>
                </div>

                <div style={{ marginTop: '4px', fontSize: '11px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {actionTitle}
                </div>

                {/* Thin progress bar underneath */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    height: '2px',
                    width: `${percent}%`,
                    background: '#10b981',
                    transition: 'width 0.3s ease',
                  }}
                />
              </Link>
            );
          })}
        </div>
      )}
    </aside>
  );
}
