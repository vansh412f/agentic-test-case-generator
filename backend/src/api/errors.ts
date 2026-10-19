import { CrawlError } from '../crawler/crawlErrors.ts';
import { DatabaseError } from '../db/errors.ts';
import type { DatabaseErrorCode } from '../db/errors.ts';
import { ExportError } from '../export/errors.ts';
import type { ExportErrorCode } from '../export/errors.ts';
import { JobError } from './jobErrors.ts';
import type { JobErrorCode } from './jobErrors.ts';
import type { CrawlErrorCode } from '../crawler/crawlErrors.ts';
import { LlmError } from '../llm/types.ts';
import type { LlmErrorCode } from '../llm/types.ts';
import { RunnerError } from '../runner/errors.ts';
import type { RunnerErrorCode } from '../runner/errors.ts';

export type CommonApiErrorCode =
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'DAILY_QUOTA_EXHAUSTED'
  | 'QUEUE_FULL'
  | 'POW_FAILED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'BROWSER_LAUNCH_FAILED'
  | 'INVALID_REQUEST'
  | 'INVALID_WEBHOOK_URL';

const CRAWL_ERROR_STATUS: Record<CrawlErrorCode, number> = {
  INVALID_URL: 400,
  NAVIGATION_TIMEOUT: 504,
  NAVIGATION_FAILED: 502,
  EXTRACTION_FAILED: 500,
  BROWSER_LAUNCH_FAILED: 503,
  TARGET_WAKING: 503,
  TUNNEL_HOST_BLOCKED: 422,
  TARGET_NOT_ALLOWED: 400,
  TARGET_UNREACHABLE: 422,
};

const LLM_ERROR_STATUS: Record<LlmErrorCode, number> = {
  RATE_LIMITED: 429,
  AUTH_FAILED: 502,
  TIMEOUT: 504,
  BAD_RESPONSE: 502,
  PROVIDER_UNAVAILABLE: 503,
  ALL_PROVIDERS_FAILED: 503,
};

export const RUNNER_ERROR_STATUS: Record<RunnerErrorCode, number> = {
  EXECUTION_TIMEOUT: 504,
  BROWSER_ERROR: 500,
  NO_RESULTS: 500,
  PARSE_ERROR: 500,
};

const DATABASE_ERROR_STATUS: Record<DatabaseErrorCode, number> = { DATABASE_UNAVAILABLE: 503 };
const JOB_ERROR_STATUS: Record<JobErrorCode, number> = {
  JOB_NOT_FOUND: 404, REPORT_NOT_READY: 409, EXPORT_NOT_READY: 409, NOT_CANCELLABLE: 409, NO_EXPORTABLE_TESTS: 409,
};
const EXPORT_ERROR_STATUS: Record<ExportErrorCode, number> = {
  INVALID_EXPORT_FILE: 500, EXPORT_FAILED: 500,
};

export interface HttpErrorResponse {
  status: number;
  body: {
    error: string;
    message: string;
    details?: unknown;
  };
  headers?: Record<string, string>;
}

export function toHttpError(err: unknown): HttpErrorResponse | null {
  if (err instanceof CrawlError) {
    const headers: Record<string, string> = {};
    if (err.code === 'TARGET_WAKING') {
      headers['Retry-After'] = '30';
    }
    return {
      status: CRAWL_ERROR_STATUS[err.code],
      body: { error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }
  if (err instanceof LlmError) {
    return {
      status: LLM_ERROR_STATUS[err.code],
      body: { error: err.code, message: err.message },
    };
  }
  if (err instanceof RunnerError) {
    return {
      status: RUNNER_ERROR_STATUS[err.code],
      body: { error: err.code, message: err.message },
    };
  }
  if (err instanceof DatabaseError) {
    return { status: DATABASE_ERROR_STATUS[err.code], body: { error: err.code, message: err.message } };
  }
  if (err instanceof JobError) {
    return { status: JOB_ERROR_STATUS[err.code], body: { error: err.code, message: err.message } };
  }
  if (err instanceof ExportError) {
    return { status: EXPORT_ERROR_STATUS[err.code], body: { error: err.code, message: err.message } };
  }
  return null;
}
// Module component implementation.
