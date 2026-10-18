const controllers = new Map<string, AbortController>();

export class JobCancelledError extends Error {
  readonly code = 'CANCELLED';

  constructor(message = 'Job was cancelled') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

export function registerJob(jobId: string): AbortSignal {
  let controller = controllers.get(jobId);
  if (!controller) {
    controller = new AbortController();
    controllers.set(jobId, controller);
  }
  return controller.signal;
}

export function cancelJob(jobId: string): boolean {
  const controller = controllers.get(jobId);
  if (controller) {
    controller.abort(new JobCancelledError());
    controllers.delete(jobId);
    return true;
  }
  return false;
}

export function release(jobId: string): void {
  controllers.delete(jobId);
}
