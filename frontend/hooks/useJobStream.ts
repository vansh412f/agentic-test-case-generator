import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { KeyedMutator } from 'swr';
import { fetcher, apiBase } from '@/lib/api';
import { isTerminalJobStatus } from '@/lib/utils';
import type { JobDetail, JobStatus, AgentStep } from '@/types/api';

export type JobTransport = 'idle' | 'sse' | 'polling';

export interface WakingInfo {
  attempt: number;
  nextRetryInSec: number;
}

export interface JobStreamResult {
  data: JobDetail | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<JobDetail>;
  transport: JobTransport;
  liveStatus: JobStatus | null;
  wakingInfo: WakingInfo | null;
  budgetNote: string | null;
}

const POLL_INTERVAL_MS = 2000;
const REFETCH_THROTTLE_MS = 250;
const MAX_CONSECUTIVE_SSE_ERRORS = 3;

const JOB_STATUSES: readonly JobStatus[] = [
  'pending',
  'crawling',
  'planning',
  'generating',
  'executing',
  'completed',
  'failed',
  'cancelled',
];

function parseJobStatus(event: Event): JobStatus | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return null;
  try {
    const parsed = JSON.parse(event.data);
    const candidate = parsed?.status;
    return typeof candidate === 'string' && (JOB_STATUSES as readonly string[]).includes(candidate)
      ? (candidate as JobStatus)
      : null;
  } catch {
    return null;
  }
}

// SSE events are invalidation signals: every event triggers a throttled
// refetch of GET /api/jobs/:id (the single source of truth for rendering).
// Polling is the fallback when SSE is unsupported, blocked, or the server
// reports `unavailable` (job is owned by no live process).
export function useJobStream(jobId: string | null, fallbackData?: JobDetail): JobStreamResult {
  const [transport, setTransport] = useState<JobTransport>('idle');
  const [liveStatus, setLiveStatus] = useState<JobStatus | null>(null);
  const [wakingInfo, setWakingInfo] = useState<WakingInfo | null>(null);
  const [budgetNote, setBudgetNote] = useState<string | null>(null);
  const key = jobId === null ? null : `${apiBase()}/api/jobs/${jobId}`;

  const swr = useSWR<JobDetail, Error>(key, fetcher, {
    fallbackData,
    revalidateOnFocus: true,
    refreshInterval: (latest) => {
      if (latest !== undefined && isTerminalJobStatus(latest.status)) return 0;
      return transport === 'polling' ? POLL_INTERVAL_MS : 0;
    },
  });

  const { mutate } = swr;
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  const initialStatus: JobStatus | undefined = fallbackData?.status;
  const startTerminal = initialStatus !== undefined && isTerminalJobStatus(initialStatus);

  useEffect(() => {
    if (!swr.data) return;
    if (transport === 'polling') {
      setLiveStatus(swr.data.status);
    }
    if (isTerminalJobStatus(swr.data.status) && transport === 'polling') {
      setTransport('idle');
    }
  }, [swr.data, transport]);

  useEffect(() => {
    setLiveStatus(null);
    setWakingInfo(null);
    setBudgetNote(null);

    if (jobId === null || startTerminal || typeof window === 'undefined' || !('EventSource' in window)) {
      setTransport(jobId === null ? 'idle' : 'polling');
      return;
    }

    // NEXT_PUBLIC_STREAM_ORIGIN (optional): direct EventSource connection bypassing Vercel rewrite.
    // The SSE stream needs no custom headers; standard browser EventSource connects directly.
    const streamOrigin = process.env.NEXT_PUBLIC_STREAM_ORIGIN
      ? process.env.NEXT_PUBLIC_STREAM_ORIGIN.replace(/\/+$/, '')
      : apiBase();
    const source = new EventSource(`${streamOrigin}/api/jobs/${jobId}/stream`);
    let errors = 0;
    let timer: number | null = null;
    let closed = false;

    const scheduleRefetch = (): void => {
      if (closed || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (!closed) void mutateRef.current();
      }, REFETCH_THROTTLE_MS);
    };

    const handleSnapshotEvent = (e: Event): void => {
      if (closed) return;
      const status = parseJobStatus(e);
      if (status) {
        setLiveStatus(status);
        if (status !== 'crawling' && status !== 'pending') {
          setWakingInfo(null);
        }
      }
      scheduleRefetch();
    };

    const handlePhaseChange = (e: Event): void => {
      if (closed) return;
      const status = parseJobStatus(e);
      if (status) {
        setLiveStatus(status);
        if (status !== 'crawling' && status !== 'pending') {
          setWakingInfo(null);
        }
        void mutateRef.current((prev) => (prev ? { ...prev, status } : prev), false);
        if (status === 'planning' || status === 'generating' || !swr.data) {
          scheduleRefetch();
        }
      } else {
        scheduleRefetch();
      }
    };

    const handleStepRecorded = (e: Event): void => {
      if (closed) return;
      if (!(e instanceof MessageEvent) || typeof e.data !== 'string') {
        scheduleRefetch();
        return;
      }
      try {
        const payload = JSON.parse(e.data);
        const data = payload?.data;
        if (!data || typeof data.stepType !== 'string' || typeof data.status !== 'string') {
          scheduleRefetch();
          return;
        }

        const stepId = typeof (e as any).lastEventId === 'string' && (e as any).lastEventId.length > 0
          ? (e as any).lastEventId
          : `sse-${Date.now()}-${Math.random()}`;

        const newStep: AgentStep = {
          id: stepId,
          jobId: jobId,
          stepType: data.stepType,
          status: data.status,
          testCaseId: data.testCaseId ?? null,
          attemptNumber: data.attemptNumber ?? null,
          latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : null,
          llmProvider: typeof data.llmProvider === 'string' ? data.llmProvider : null,
          llmModel: typeof data.llmModel === 'string' ? data.llmModel : null,
          promptTokens: typeof data.promptTokens === 'number' ? data.promptTokens : null,
          completionTokens: typeof data.completionTokens === 'number' ? data.completionTokens : null,
          errorDetail: typeof data.errorDetail === 'string' ? data.errorDetail : null,
          createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
        };

        void mutateRef.current((prev) => {
          if (!prev) {
            scheduleRefetch();
            return prev;
          }
          const promptDelta = typeof data.promptTokens === 'number' ? data.promptTokens : 0;
          const compDelta = typeof data.completionTokens === 'number' ? data.completionTokens : 0;
          const totalDelta = promptDelta + compDelta;

          const updatedUsage = totalDelta > 0 && prev.tokenUsage
            ? {
                ...prev.tokenUsage,
                totalTokens: prev.tokenUsage.totalTokens + totalDelta,
                promptTokens: prev.tokenUsage.promptTokens + promptDelta,
                completionTokens: prev.tokenUsage.completionTokens + compDelta,
              }
            : prev.tokenUsage;

          return {
            ...prev,
            tokenUsage: updatedUsage,
            agentSteps: [...prev.agentSteps, newStep],
          };
        }, false);
      } catch {
        scheduleRefetch();
      }
    };

    const stop = (next: JobTransport): void => {
      if (closed) return;
      closed = true;
      source.close();
      setTransport(next);
    };

    source.onopen = () => {
      if (closed) return;
      errors = 0;
      setTransport('sse');
    };

    source.addEventListener('snapshot', handleSnapshotEvent);
    source.addEventListener('phase_change', handlePhaseChange);
    source.addEventListener('step_recorded', handleStepRecorded);
    source.addEventListener('test_completed', scheduleRefetch);
    source.addEventListener('budget_note', (e: Event) => {
      if (closed) return;
      if (e instanceof MessageEvent && typeof e.data === 'string') {
        try {
          const parsed = JSON.parse(e.data);
          if (typeof parsed?.message === 'string') {
            setBudgetNote(parsed.message);
          }
        } catch {}
      }
    });
    source.addEventListener('target_waking', (e: Event) => {
      if (closed) return;
      if (e instanceof MessageEvent && typeof e.data === 'string') {
        try {
          const parsed = JSON.parse(e.data);
          if (typeof parsed?.attempt === 'number') {
            setWakingInfo({
              attempt: parsed.attempt,
              nextRetryInSec: typeof parsed.nextRetryInSec === 'number' ? parsed.nextRetryInSec : 30,
            });
          }
        } catch {}
      }
      scheduleRefetch();
    });
    source.addEventListener('queue_position', (e: Event) => {
      if (closed) return;
      if (e instanceof MessageEvent && typeof e.data === 'string') {
        try {
          const parsed = JSON.parse(e.data);
          if (typeof parsed?.position === 'number') {
            void mutateRef.current(
              (prev) => (prev ? { ...prev, queuePosition: parsed.position } : prev),
              false,
            );
          }
        } catch {}
      }
      scheduleRefetch();
    });
    source.addEventListener('job_finished', (e: Event) => {
      if (closed) return;
      const status = parseJobStatus(e);
      if (status) setLiveStatus(status);
      stop('idle');
      void mutateRef.current();
    });
    source.addEventListener('unavailable', () => stop('polling'));
    source.onerror = () => {
      if (closed) return;
      errors += 1;
      if (source.readyState === EventSource.CLOSED || errors >= MAX_CONSECUTIVE_SSE_ERRORS) {
        stop('polling');
      }
    };

    return () => {
      closed = true;
      if (timer !== null) window.clearTimeout(timer);
      source.close();
    };
  }, [jobId, startTerminal]);

  return {
    data: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
    transport,
    liveStatus,
    wakingInfo,
    budgetNote,
  };
}
