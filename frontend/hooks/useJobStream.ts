import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { KeyedMutator } from 'swr';
import { fetcher, apiBase } from '@/lib/api';
import { isTerminalJobStatus } from '@/lib/utils';
import type { JobDetail, JobStatus } from '@/types/api';

export type JobTransport = 'idle' | 'sse' | 'polling';

export interface JobStreamResult {
  data: JobDetail | undefined;
  error: Error | undefined;
  isLoading: boolean;
  mutate: KeyedMutator<JobDetail>;
  transport: JobTransport;
}

const POLL_INTERVAL_MS = 2000;
const REFETCH_THROTTLE_MS = 750;
const MAX_CONSECUTIVE_SSE_ERRORS = 3;
const STREAM_EVENTS = ['snapshot', 'phase_change', 'step_recorded', 'test_completed'] as const;

// SSE events are invalidation signals: every event triggers a throttled
// refetch of GET /api/jobs/:id (the single source of truth for rendering).
// Polling is the fallback when SSE is unsupported, blocked, or the server
// reports `unavailable` (job is owned by no live process).
export function useJobStream(jobId: string | null, fallbackData?: JobDetail): JobStreamResult {
  const [transport, setTransport] = useState<JobTransport>('idle');
  const key = jobId === null ? null : `${apiBase()}/api/jobs/${jobId}`;

  const swr = useSWR<JobDetail, Error>(key, fetcher, {
    fallbackData,
    revalidateOnFocus: true,
    refreshInterval: (latest) => {
      if (latest !== undefined && isTerminalJobStatus(latest.status)) return 0;
      return transport === 'sse' ? 0 : POLL_INTERVAL_MS;
    },
  });

  const { mutate } = swr;
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  const initialStatus: JobStatus | undefined = fallbackData?.status;
  const startTerminal = initialStatus !== undefined && isTerminalJobStatus(initialStatus);

  useEffect(() => {
    if (jobId === null || startTerminal || typeof window === 'undefined' || !('EventSource' in window)) {
      setTransport(jobId === null ? 'idle' : 'polling');
      return;
    }

    const source = new EventSource(`${apiBase()}/api/jobs/${jobId}/stream`);
    let errors = 0;
    let timer: number | null = null;
    let closed = false;

    const scheduleRefetch = (): void => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void mutateRef.current();
      }, REFETCH_THROTTLE_MS);
    };

    const stop = (next: JobTransport): void => {
      if (closed) return;
      closed = true;
      source.close();
      setTransport(next);
    };

    source.onopen = () => {
      errors = 0;
      setTransport('sse');
    };
    for (const name of STREAM_EVENTS) source.addEventListener(name, scheduleRefetch);
    source.addEventListener('job_finished', () => {
      stop('idle');
      void mutateRef.current();
    });
    source.addEventListener('unavailable', () => stop('polling'));
    source.onerror = () => {
      // EventSource auto-reconnects (server sends retry: 3000). A 4xx/5xx
      // response closes it permanently (readyState CLOSED).
      errors += 1;
      if (source.readyState === EventSource.CLOSED || errors >= MAX_CONSECUTIVE_SSE_ERRORS) {
        stop('polling');
      } else {
        setTransport('polling');
      }
    };

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      closed = true;
      source.close();
    };
  }, [jobId, startTerminal]);

  return {
    data: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: swr.mutate,
    transport,
  };
}
