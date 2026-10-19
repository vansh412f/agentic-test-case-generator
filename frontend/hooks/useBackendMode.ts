import useSWR from 'swr';
import { getDeploymentMode } from '../lib/targetUrl';

interface HealthResponse {
  ok: boolean;
  uptimeSec: number;
  mode?: 'local' | 'hosted';
}

const fetcher = async (url: string): Promise<HealthResponse> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch health');
  }
  return res.json();
};

let cachedResolvedMode: 'local' | 'hosted' | null = null;
let resolvePromise: Promise<'local' | 'hosted'> | null = null;

export async function fetchBackendMode(): Promise<'local' | 'hosted'> {
  if (cachedResolvedMode) return cachedResolvedMode;
  if (!resolvePromise) {
    resolvePromise = (async () => {
      try {
        const data = await fetcher('/api/health');
        cachedResolvedMode = data.mode ?? getDeploymentMode();
      } catch {
        cachedResolvedMode = getDeploymentMode();
      }
      return cachedResolvedMode;
    })();
  }
  return resolvePromise;
}

export function useBackendMode(): {
  mode: 'local' | 'hosted';
  isLocal: boolean;
  isLoading: boolean;
} {
  const fallback = getDeploymentMode();
  const { data, isLoading } = useSWR<HealthResponse>('/api/health', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60 * 60 * 1000,
    fallbackData: cachedResolvedMode
      ? { ok: true, uptimeSec: 0, mode: cachedResolvedMode }
      : undefined,
  });

  if (data?.mode) {
    cachedResolvedMode = data.mode;
  }

  const mode = data?.mode ?? cachedResolvedMode ?? fallback;
  return {
    mode,
    isLocal: mode === 'local',
    isLoading: isLoading && !cachedResolvedMode,
  };
}
