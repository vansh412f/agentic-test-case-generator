import type {
  ApiErrorBody,
  AppMap,
  BatchResponse,
  GenerateSingleResponse,
  JobDetail,
  JobsListResponse,
} from '@/types/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function readError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;

  return new ApiError(
    response.status,
    body?.error ?? 'REQUEST_FAILED',
    body?.message ?? `Request failed with status ${response.status}`,
  );
}

export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw await readError(response);
  }

  // Fetch boundaries are the one unavoidable generic cast in the client.
  return (await response.json()) as T;
}

async function postJson<TResponse, TBody>(url: string, body: TBody): Promise<TResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await readError(response);
  }

  // Fetch boundaries are the one unavoidable generic cast in the client.
  return (await response.json()) as TResponse;
}

export function crawlPage(url: string): Promise<AppMap> {
  return postJson<AppMap, { url: string }>('/api/crawl', { url });
}

export function generateSingle(url: string): Promise<GenerateSingleResponse> {
  return postJson<GenerateSingleResponse, { url: string }>('/api/generate', { url });
}

export function generateBatch(urls: string[]): Promise<BatchResponse> {
  return postJson<BatchResponse, { urls: string[] }>('/api/generate', { urls });
}

export function getJob(jobId: string): Promise<JobDetail> {
  return fetcher<JobDetail>(`/api/jobs/${jobId}`);
}

export function getJobs(page: number, limit: number): Promise<JobsListResponse> {
  return fetcher<JobsListResponse>(`/api/jobs?page=${page}&limit=${limit}`);
}
