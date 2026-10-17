import type {
  ApiErrorBody,
  AppMap,
  GenerateAcceptedResponse,
  JobDetail,
  JobsListResponse,
} from '@/types/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: any;

  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function readError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;

  return new ApiError(
    response.status,
    body?.error ?? 'REQUEST_FAILED',
    body?.message ?? `Request failed with status ${response.status}`,
    body?.details,
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

function resolveUrl(url: string): string {
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

  const response = await fetch('/api/byok/validate', {
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

export async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(resolveUrl(url), {
    headers: buildHeaders(),
  });

  captureVisitorToken(response);

  if (!response.ok) {
    throw await readError(response);
  }

  // Fetch boundaries are the one unavoidable generic cast in the client.
  return (await response.json()) as T;
}

async function postJson<TResponse, TBody>(url: string, body: TBody): Promise<TResponse> {
  const response = await fetch(resolveUrl(url), {
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

export function startGeneration(urls: string[], altcha?: string): Promise<GenerateAcceptedResponse> {
  const target = urls.length === 1 ? { url: urls[0] ?? '' } : { urls };
  return postJson<GenerateAcceptedResponse, ({ url: string } | { urls: string[] }) & { altcha?: string }>(
    '/api/generate',
    { ...target, ...(altcha ? { altcha } : {}) },
  );
}

export function getJob(jobId: string): Promise<JobDetail> {
  return fetcher<JobDetail>(`/api/jobs/${jobId}`);
}

export function getJobs(page: number, limit: number): Promise<JobsListResponse> {
  return fetcher<JobsListResponse>(`/api/jobs?page=${page}&limit=${limit}`);
}
