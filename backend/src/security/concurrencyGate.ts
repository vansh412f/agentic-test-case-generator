export class QueueFullError extends Error {
  readonly code = 'QUEUE_FULL';
  constructor(message = 'The execution queue is currently full. Please retry shortly.') {
    super(message);
    this.name = 'QueueFullError';
  }
}

export class ConcurrencyGate {
  private active = 0;

  constructor(private readonly max: number) {}

  tryAcquire(): boolean {
    if (this.active >= this.max) return false;
    this.active += 1;
    return true;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }

  get activeCount(): number {
    return this.active;
  }
}

export const pipelineGate = new ConcurrencyGate(2);
