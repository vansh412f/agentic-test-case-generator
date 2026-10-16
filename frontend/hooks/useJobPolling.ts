import useSWR from 'swr';
import type { SWRResponse } from 'swr';
import { fetcher, apiBase } from '@/lib/api';
import { isTerminalJobStatus } from '@/lib/utils';
import type { JobDetail } from '@/types/api';

export function useJobPolling(
  jobId: string | null,
  fallbackData?: JobDetail,
): SWRResponse<JobDetail, Error> {
  return useSWR<JobDetail, Error>(
    jobId === null ? null : `${apiBase()}/api/jobs/${jobId}`,
    fetcher,
    {
      fallbackData,
      refreshInterval: (latest) =>
        latest !== undefined && isTerminalJobStatus(latest.status) ? 0 : 2000,
      revalidateOnFocus: true,
    },
  );
}
