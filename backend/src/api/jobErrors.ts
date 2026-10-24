export type JobErrorCode =
  | 'JOB_NOT_FOUND'
  | 'REPORT_NOT_READY'
  | 'EXPORT_NOT_READY'
  | 'NOT_CANCELLABLE'
  | 'NO_EXPORTABLE_TESTS'
  | 'TRACE_NOT_FOUND';

export class JobError extends Error {
  constructor(public readonly code: JobErrorCode, message: string) {
    super(message);
    this.name = 'JobError';
  }
}

export const JOB_ERROR_MESSAGES: Record<JobErrorCode, string> = {
  JOB_NOT_FOUND: 'Job not found.',
  REPORT_NOT_READY: 'The job has not finished.',
  EXPORT_NOT_READY: 'No generated tests are available.',
  NOT_CANCELLABLE: 'Job is already finished.',
  NO_EXPORTABLE_TESTS: 'No exportable tests are available for this job.',
  TRACE_NOT_FOUND: 'No trace is available for this test. Traces are kept for one hour after execution.',
};

export function jobError(code: JobErrorCode): JobError {
  return new JobError(code, JOB_ERROR_MESSAGES[code]);
}
