export const CRAWL_ERROR_CODES = [
  'INVALID_URL',
  'NAVIGATION_FAILED',
  'NAVIGATION_TIMEOUT',
  'EXTRACTION_FAILED',
] as const;

export type CrawlErrorCode = (typeof CRAWL_ERROR_CODES)[number];

export class CrawlError extends Error {
  public readonly code: CrawlErrorCode;

  constructor(code: CrawlErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'CrawlError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}