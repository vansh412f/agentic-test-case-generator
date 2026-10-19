export const CRAWL_ERROR_CODES = [
  'INVALID_URL',
  'NAVIGATION_FAILED',
  'NAVIGATION_TIMEOUT',
  'EXTRACTION_FAILED',
  'BROWSER_LAUNCH_FAILED',
  'TARGET_WAKING',
  'TUNNEL_HOST_BLOCKED',
  'TARGET_NOT_ALLOWED',
  'TARGET_UNREACHABLE',
] as const;

export type CrawlErrorCode = (typeof CRAWL_ERROR_CODES)[number];

export class CrawlError extends Error {
  public readonly code: CrawlErrorCode;
  public readonly details?: unknown;

  constructor(code: CrawlErrorCode, message: string, cause?: unknown, details?: unknown) {
    super(message);
    this.name = 'CrawlError';
    this.code = code;
    this.details = details;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}