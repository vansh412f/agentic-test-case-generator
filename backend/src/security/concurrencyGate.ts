import { config } from '../config.ts';

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

// One slot = one run group (1..MAX_URLS_PER_RUN sequential jobs).
export const pipelineGate = new ConcurrencyGate(config.PIPELINE_CONCURRENCY);
export const crawlGate = new ConcurrencyGate(config.CRAWL_CONCURRENCY);

export class WaitableSemaphore {
  private active = 0;
  private readonly waiting: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxWaiting: number = 3,
    private readonly timeoutMs: number = 45_000,
  ) {}

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.waiting.length;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.maxActive) {
      this.active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.release();
      };
    }

    if (this.waiting.length >= this.maxWaiting) {
      throw new QueueFullError('Previews are busy, retry in a moment.');
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiting.findIndex((item) => item.timer === timer);
        if (idx !== -1) {
          this.waiting.splice(idx, 1);
        }
        reject(new QueueFullError('Previews are busy, retry in a moment.'));
      }, this.timeoutMs);

      this.waiting.push({
        resolve: (releaseFn) => {
          clearTimeout(timer);
          resolve(releaseFn);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
    });
  }

  private release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      let released = false;
      next.resolve(() => {
        if (released) return;
        released = true;
        this.release();
      });
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }
}

export const crawlSemaphore = new WaitableSemaphore(config.CRAWL_CONCURRENCY, 3, 45_000);


// Module component implementation.
