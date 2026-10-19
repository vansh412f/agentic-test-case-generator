import { randomUUID } from 'node:crypto';
import { openJobChannel, publishJobEvent } from './jobEvents.ts';
import { startDetachedRun, type QueuedJob, type RunOne } from './jobRunner.ts';
import type { RequestLlmKeys } from '../llm/requestKeys.ts';
import type { WebhookTarget } from '../notify/webhook.ts';
import { config } from '../config.ts';

export interface ClientKey {
  visitorId: string | null;
  ipHash: string;
}

export interface ClaimToken {
  id: string;
  client: ClientKey;
  claimedAt: number;
}

export interface RunGroup {
  groupId: string;
  jobs: QueuedJob[];
  keys: RequestLlmKeys;
  webhook?: WebhookTarget;
  client: ClientKey;
  enqueuedAt: number;
}

function matchesClient(a: ClientKey, b: ClientKey): boolean {
  if (a.visitorId && b.visitorId && a.visitorId === b.visitorId) return true;
  if (a.ipHash && b.ipHash && a.ipHash === b.ipHash) return true;
  return false;
}

export class RunQueue {
  private activeGroups: RunGroup[] = [];
  private waitingGroups: RunGroup[] = [];
  private pendingClaims: Map<string, ClaimToken> = new Map();
  private runnerOverride?: (group: RunGroup, onSettled: () => void) => void;
  private runOneOverride?: RunOne;

  constructor(
    private readonly maxActive: number,
    private readonly maxWaiting: number,
  ) {}

  get activeCount(): number {
    return this.activeGroups.length;
  }

  get waitingCount(): number {
    return this.waitingGroups.length;
  }

  isFull(): boolean {
    return (
      this.waitingGroups.length >= this.maxWaiting &&
      this.activeGroups.length >= this.maxActive
    );
  }

  claim(client: ClientKey): ClaimToken | null {
    const now = Date.now();
    for (const [id, c] of this.pendingClaims.entries()) {
      if (now - c.claimedAt > 60_000) {
        this.pendingClaims.delete(id);
      }
    }

    for (const group of this.activeGroups) {
      if (matchesClient(group.client, client)) return null;
    }
    for (const group of this.waitingGroups) {
      if (matchesClient(group.client, client)) return null;
    }
    for (const claim of this.pendingClaims.values()) {
      if (matchesClient(claim.client, client)) return null;
    }

    const token: ClaimToken = {
      id: randomUUID(),
      client,
      claimedAt: now,
    };
    this.pendingClaims.set(token.id, token);
    return token;
  }

  releaseClaim(token: ClaimToken | string | null | undefined): void {
    if (!token) return;
    const id = typeof token === 'string' ? token : token.id;
    this.pendingClaims.delete(id);
  }

  activeOrQueuedFor(c: ClientKey): RunGroup | undefined {
    for (const group of this.activeGroups) {
      if (matchesClient(group.client, c)) return group;
    }
    for (const group of this.waitingGroups) {
      if (matchesClient(group.client, c)) return group;
    }
    return undefined;
  }

  enqueue(g: RunGroup, claimToken?: ClaimToken | string | null): number {
    if (claimToken) {
      this.releaseClaim(claimToken);
    }
    for (const job of g.jobs) {
      openJobChannel(job.id);
    }

    if (this.activeGroups.length < this.maxActive) {
      this.activeGroups.push(g);
      this.startGroup(g);
      return 0;
    }

    this.waitingGroups.push(g);
    const position = this.waitingGroups.length;
    this.publishPositions();
    return position;
  }

  removeQueuedJob(jobId: string): RunGroup | undefined {
    const idx = this.waitingGroups.findIndex((g) =>
      g.jobs.some((j) => j.id === jobId),
    );
    if (idx === -1) return undefined;
    const group = this.waitingGroups[idx];
    const jobIdx = group.jobs.findIndex((j) => j.id === jobId);
    if (jobIdx !== -1) {
      group.jobs.splice(jobIdx, 1);
    }
    if (group.jobs.length === 0) {
      this.waitingGroups.splice(idx, 1);
    }
    this.publishPositions();
    return group;
  }

  positionOf(jobId: string): number | null {
    for (let i = 0; i < this.waitingGroups.length; i++) {
      if (this.waitingGroups[i].jobs.some((j) => j.id === jobId)) {
        return i + 1;
      }
    }
    return null;
  }

  private pump(): void {
    while (
      this.activeGroups.length < this.maxActive &&
      this.waitingGroups.length > 0
    ) {
      const next = this.waitingGroups.shift()!;
      this.activeGroups.push(next);
      this.publishPositions();
      this.startGroup(next);
    }
  }

  private publishPositions(): void {
    this.waitingGroups.forEach((group, index) => {
      const position = index + 1;
      for (const job of group.jobs) {
        publishJobEvent(job.id, {
          type: 'queue_position',
          data: { position },
        });
      }
    });
  }

  private startGroup(g: RunGroup): void {
    const onSettled = () => {
      const idx = this.activeGroups.indexOf(g);
      if (idx !== -1) {
        this.activeGroups.splice(idx, 1);
      }
      this.pump();
    };

    if (this.runnerOverride) {
      this.runnerOverride(g, onSettled);
      return;
    }

    startDetachedRun(g.jobs, g.keys, {
      webhook: g.webhook,
      runOne: this.runOneOverride,
      onSettled,
    });
  }

  setRunnerForTest(
    fn: ((group: RunGroup, onSettled: () => void) => void) | undefined,
  ): void {
    this.runnerOverride = fn;
  }

  setRunOneForTest(fn: RunOne | undefined): void {
    this.runOneOverride = fn;
  }

  resetForTest(): void {
    this.activeGroups = [];
    this.waitingGroups = [];
    this.runnerOverride = undefined;
    this.runOneOverride = undefined;
  }
}

export const runQueue = new RunQueue(
  config.PIPELINE_CONCURRENCY,
  config.QUEUE_MAX_WAITING_GROUPS,
);
// Module component implementation.
