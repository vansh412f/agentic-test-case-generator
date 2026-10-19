export const RUNNER_ERROR_CODES = [
  'EXECUTION_TIMEOUT',
  'BROWSER_ERROR',
  'NO_RESULTS',
  'PARSE_ERROR',
  'RUNNER_UNAVAILABLE',
] as const;

export type RunnerErrorCode = (typeof RUNNER_ERROR_CODES)[number];

export class RunnerError extends Error {
  public readonly code: RunnerErrorCode;

  constructor(code: RunnerErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
