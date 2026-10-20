export type JobErrorCode =
  | 'JOB_NOT_FOUND'
  | 'REPORT_NOT_READY'
  | 'EXPORT_NOT_READY'
  | 'NOT_CANCELLABLE'
  | 'NO_EXPORTABLE_TESTS'
  | 'RERUN_NOT_READY'
  | 'RERUN_IN_PROGRESS'
  | 'BASELINE_NOT_EDITABLE'
  | 'TRACE_NOT_FOUND'
  | 'TEST_DATA_REQUIRED';

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
  RERUN_NOT_READY: 'This job is still running. Wait for it to finish before re-running a test.',
  RERUN_IN_PROGRESS: 'This test is already being re-run.',
  BASELINE_NOT_EDITABLE: "Baseline smoke tests can't be edited.",
  TRACE_NOT_FOUND: 'No trace is available for this test. Traces are kept for one hour after a re-run.',
  TEST_DATA_REQUIRED: 'This test needs test data. Enter values for all protected fields to run it.',
};

export function jobError(code: JobErrorCode): JobError {
  return new JobError(code, JOB_ERROR_MESSAGES[code]);
}
