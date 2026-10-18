export type JobErrorCode = 'JOB_NOT_FOUND' | 'REPORT_NOT_READY' | 'EXPORT_NOT_READY' | 'NOT_CANCELLABLE';

export class JobError extends Error {
  constructor(public readonly code: JobErrorCode, message: string) {
    super(message);
    this.name = 'JobError';
  }
}
