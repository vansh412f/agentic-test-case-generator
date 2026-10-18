import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { KeyedMutator } from 'swr';
import { fetcher, apiBase } from '@/lib/api';
import { isTerminalJobStatus } from '@/lib/utils';
import type { JobDetail, JobStatus } from '@/types/api';

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
const REFETCH_THROTTLE_MS = 750;
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
    if (swr.data && isTerminalJobStatus(swr.data.status) && transport === 'polling') {
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

    const source = new EventSource(`${apiBase()}/api/jobs/${jobId}/stream`);
    let errors = 0;
    let timer: number | null = null;
    let stepTimer: number | null = null;
    let closed = false;

    const scheduleRefetch = (): void => {
      if (closed || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (!closed) void mutateRef.current();
      }, REFETCH_THROTTLE_MS);
    };

    const scheduleStepRefetch = (): void => {
      if (closed) return;
      if (stepTimer !== null) window.clearTimeout(stepTimer);
      stepTimer = window.setTimeout(() => {
        stepTimer = null;
        if (!closed) void mutateRef.current();
      }, 5000);
    };

    const handleStatusEvent = (e: Event): void => {
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

    source.addEventListener('snapshot', handleStatusEvent);
    source.addEventListener('phase_change', handleStatusEvent);
    source.addEventListener('step_recorded', scheduleStepRefetch);
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
      if (stepTimer !== null) window.clearTimeout(stepTimer);
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
