import type {
  AppMap,
  GenerateAcceptedResponse,
  JobDetail,
  JobsListResponse,
} from '@/types/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorDetail(error: ApiError, key: string): string | number | undefined {
  if (typeof error.details !== 'object' || error.details === null) return undefined;
  const value = (error.details as Record<string, unknown>)[key];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

export function errorDetailRaw(error: ApiError, key: string): unknown {
  if (typeof error.details !== 'object' || error.details === null) return undefined;
  return (error.details as Record<string, unknown>)[key];
}

async function readError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '');
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  const isApiErrorBody = (
    v: unknown,
  ): v is { error: string; message: string; details?: unknown } => {
    return (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as Record<string, unknown>).error === 'string' &&
      typeof (v as Record<string, unknown>).message === 'string'
    );
  };

  if (isApiErrorBody(parsed)) {
    return new ApiError(response.status, parsed.error, parsed.message, parsed.details);
  }

  if (response.status >= 500) {
    return new ApiError(
      response.status,
      'UPSTREAM_UNAVAILABLE',
      'The server is unreachable or still waking up (free-tier servers can take up to a minute). Please retry shortly.',
    );
  }

  return new ApiError(
    response.status,
    'REQUEST_FAILED',
    `Request failed with status ${response.status}`,
  );
}

let memoryVisitorToken: string | null = null;

export function getVisitorToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('atsg-visitor-id') ?? memoryVisitorToken;
  } catch {
    return memoryVisitorToken;
  }
}

export function setVisitorToken(token: string): void {
  memoryVisitorToken = token;
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('atsg-visitor-id', token);
  } catch {
    // In-memory fallback is already updated
  }
}

function captureVisitorToken(response: Response): void {
  const token = response.headers.get('x-visitor-id');
  if (token) {
    setVisitorToken(token);
  }
}

export interface StoredApiKeys {
  groq?: string;
  gemini?: string;
}

export function getStoredKeys(): StoredApiKeys {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem('atsg-byok');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveStoredKeys(keys: StoredApiKeys): void {
  if (typeof window === 'undefined') return;
  try {
    const clean: StoredApiKeys = {};
    if (keys.groq?.trim()) clean.groq = keys.groq.trim();
    if (keys.gemini?.trim()) clean.gemini = keys.gemini.trim();
    sessionStorage.setItem('atsg-byok', JSON.stringify(clean));
  } catch {
    // Storage access may fail in hardened browser modes
  }
}

export function clearStoredKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem('atsg-byok');
  } catch {
    // Ignore
  }
}

export type ApiMode = 'hosted' | 'local-agent';

export function getApiMode(): ApiMode {
  if (typeof window === 'undefined') return 'hosted';
  try {
    return (localStorage.getItem('atsg-api-mode') as ApiMode) || 'hosted';
  } catch {
    return 'hosted';
  }
}

export function setApiMode(mode: ApiMode): void {
  if (typeof window === 'undefined') return;
  try {
    if (mode === 'hosted') {
      localStorage.removeItem('atsg-api-mode');
    } else {
      localStorage.setItem('atsg-api-mode', mode);
    }
  } catch {
    // Ignore
  }
}

export function apiBase(): string {
  return getApiMode() === 'local-agent' ? 'http://localhost:4000' : '';
}

export function resolveUrl(url: string): string {
  if (url.startsWith('/api')) {
    return `${apiBase()}${url}`;
  }
  return url;
}

export function hasConfiguredKeys(): boolean {
  const keys = getStoredKeys();
  return Boolean(keys.groq || keys.gemini);
}

export async function validateApiKey(
  provider: 'groq' | 'gemini',
  key: string,
): Promise<{ valid: boolean; reason?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (provider === 'groq') {
    headers['X-Groq-Api-Key'] = key.trim();
  } else {
    headers['X-Gemini-Api-Key'] = key.trim();
  }

  const response = await fetch(resolveUrl('/api/byok/validate'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ provider }),
  });

  if (!response.ok) {
    return { valid: false, reason: 'unreachable' };
  }

  return (await response.json()) as { valid: boolean; reason?: string };
}

function buildHeaders(extra?: Record<string, string>, includeKeys = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extra,
  };
  const token = getVisitorToken();
  if (token) {
    headers['X-Visitor-Id'] = token;
  }
  if (includeKeys) {
    const keys = getStoredKeys();
    if (keys.groq) headers['X-Groq-Api-Key'] = keys.groq;
    if (keys.gemini) headers['X-Gemini-Api-Key'] = keys.gemini;
  }
  return headers;
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(resolveUrl(url), init);
  } catch (_err) {
    const isLocal = getApiMode() === 'local-agent';
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      isLocal
        ? 'Could not reach your local agent at localhost:4000. Is it running?'
        : 'Could not reach the server. Check your connection and retry.',
    );
  }
}

export async function fetcher<T>(url: string, includeKeys = false): Promise<T> {
  const response = await request(url, {
    headers: buildHeaders(undefined, includeKeys),
  });

  captureVisitorToken(response);

  if (!response.ok) {
    throw await readError(response);
  }

  // Fetch boundaries are the one unavoidable generic cast in the client.
  return (await response.json()) as T;
}

async function postJson<TResponse, TBody>(url: string, body: TBody): Promise<TResponse> {
  const response = await request(url, {
    method: 'POST',
    headers: buildHeaders(
      {
        'Content-Type': 'application/json',
      },
      true,
    ),
    body: JSON.stringify(body),
  });

  captureVisitorToken(response);

  if (!response.ok) {
    throw await readError(response);
  }

  // Fetch boundaries are the one unavoidable generic cast in the client.
  return (await response.json()) as TResponse;
}

export function crawlPage(url: string): Promise<AppMap> {
  return postJson<AppMap, { url: string }>('/api/crawl', { url });
}

export const MAX_URLS_PER_RUN = 5;

export interface TestDataParam {
  elementId: string;
  css: string;
  value: string;
  sensitive: boolean;
}

export interface FocusParam {
  elementId: string;
  css: string;
}

export function startGeneration(
  urls: string[],
  altcha?: string,
  options: {
    testData?: TestDataParam[];
    testDataByUrl?: Record<string, TestDataParam[]>;
    focus?: FocusParam[];
    fresh?: boolean;
  } = {},
): Promise<GenerateAcceptedResponse> {
  const base = {
    ...(altcha ? { altcha } : {}),
    ...(options.testData && options.testData.length > 0 ? { testData: options.testData } : {}),
    ...(options.focus && options.focus.length > 0 ? { focus: options.focus } : {}),
    ...(options.fresh ? { fresh: true } : {}),
  };

  const body =
    urls.length === 1
      ? {
          url: urls[0] ?? '',
          ...base,
        }
      : {
          urls,
          ...(options.testDataByUrl && Object.keys(options.testDataByUrl).length > 0
            ? { testDataByUrl: options.testDataByUrl }
            : {}),
          ...base,
        };

  return postJson<GenerateAcceptedResponse, typeof body>('/api/generate', body);
}

export function getJob(jobId: string): Promise<JobDetail> {
  return fetcher<JobDetail>(`/api/jobs/${jobId}`);
}

export function getJobs(page: number, limit: number): Promise<JobsListResponse> {
  return fetcher<JobsListResponse>(`/api/jobs?page=${page}&limit=${limit}`);
}

export interface BudgetScope {
  scope: 'global' | 'visitor' | 'ip';
  limit: number;
  used: number;
}

export interface BudgetResponse {
  byok: boolean;
  maxUrlsPerRun: number;
  remaining: number | null;
  resetsAt: string;
  scopes: BudgetScope[];
}

export function getBudget(): Promise<BudgetResponse> {
  return fetcher<BudgetResponse>('/api/budget', true);
}

export async function cancelJob(
  id: string,
  scope: 'job' | 'group' = 'job',
): Promise<{ cancelled: string[] }> {
  const response = await request(`/api/jobs/${id}/cancel`, {
    method: 'POST',
    headers: buildHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ scope }),
  });

  captureVisitorToken(response);

  if (!response.ok) {
    throw await readError(response);
  }

  return (await response.json()) as { cancelled: string[] };
}

export async function getTraceLinks(
  jobId: string,
  testCaseId: string,
  attempt: number,
): Promise<{ traceId: string; expiresAt: string; downloadPath: string; viewerPath: string }> {
  return fetcher<{
    traceId: string;
    expiresAt: string;
    downloadPath: string;
    viewerPath: string;
  }>(`/api/jobs/${jobId}/tests/${encodeURIComponent(testCaseId)}/trace?attempt=${attempt}`);
}

