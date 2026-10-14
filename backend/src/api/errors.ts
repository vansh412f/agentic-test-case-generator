import { CrawlError } from '../crawler/crawlErrors.ts';
import type { CrawlErrorCode } from '../crawler/crawlErrors.ts';
import { LlmError } from '../llm/types.ts';
import type { LlmErrorCode } from '../llm/types.ts';

const CRAWL_ERROR_STATUS: Record<CrawlErrorCode, number> = {
  INVALID_URL: 400,
  NAVIGATION_TIMEOUT: 504,
  NAVIGATION_FAILED: 502,
  EXTRACTION_FAILED: 500,
};

const LLM_ERROR_STATUS: Record<LlmErrorCode, number> = {
  RATE_LIMITED: 429,
  AUTH_FAILED: 502,
  TIMEOUT: 504,
  BAD_RESPONSE: 502,
  PROVIDER_UNAVAILABLE: 503,
  ALL_PROVIDERS_FAILED: 503,
};

export interface HttpErrorResponse {
  status: number;
  body: {
    error: string;
    message: string;
    details?: unknown;
  };
}

export function toHttpError(err: unknown): HttpErrorResponse | null {
  if (err instanceof CrawlError) {
    return {
      status: CRAWL_ERROR_STATUS[err.code],
      body: { error: err.code, message: err.message },
    };
  }
  if (err instanceof LlmError) {
    return {
      status: LLM_ERROR_STATUS[err.code],
      body: { error: err.code, message: err.message },
    };
  }
  return null;
}
