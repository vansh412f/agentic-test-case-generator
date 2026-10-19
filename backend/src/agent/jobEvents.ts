import { randomUUID } from 'node:crypto';
import type { JobStatus, StepStatus, StepType, TestStatus } from '@prisma/client';

export type JobEventPayload =
  | { type: 'phase_change'; data: { status: JobStatus } }
  | {
      type: 'step_recorded';
      data: { stepType: StepType; status: StepStatus; testCaseId: string | null; attemptNumber: number | null };
    }
  | { type: 'test_completed'; data: { testCaseId: string; status: TestStatus; totalAttempts: number } }
  | { type: 'job_finished'; data: { status: 'completed' | 'failed' | 'cancelled'; errorCode: string | null } }
  | { type: 'queue_position'; data: { position: number } }
  | { type: 'target_waking'; data: { attempt: number; nextRetryInSec: number } }
  | { type: 'budget_note'; data: { message: string } };

export type JobEvent = JobEventPayload & { id: string; seq: number };

type Listener = (event: JobEvent) => void;

interface Channel {
  seq: number;
  buffer: JobEvent[];
  listeners: Set<Listener>;
  finished: boolean;
}

export interface JobSubscription {
  replay: JobEvent[];
  unsubscribe: () => void;
}

// Event ids are "<bootId>.<seq>". A Last-Event-ID from a previous process
// cannot be compared against this process's seq counter, so it triggers a
// full buffer replay instead of a filtered one.
const BOOT_ID = randomUUID().slice(0, 8);
const BUFFER_LIMIT = 200;
const RETAIN_AFTER_FINISH_MS = 5 * 60_000;

const channels = new Map<string, Channel>();

export function openJobChannel(jobId: string): void {
  if (!channels.has(jobId)) {
    channels.set(jobId, { seq: 0, buffer: [], listeners: new Set(), finished: false });
  }
}

export function publishJobEvent(jobId: string, payload: JobEventPayload): void {
  const channel = channels.get(jobId);
  if (!channel || channel.finished) return;

  channel.seq += 1;
  const event: JobEvent = { ...payload, seq: channel.seq, id: `${BOOT_ID}.${channel.seq}` };
  channel.buffer.push(event);
  if (channel.buffer.length > BUFFER_LIMIT) channel.buffer.shift();

  for (const listener of channel.listeners) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[JobEvents] listener failed:', error instanceof Error ? error.message : String(error));
    }
  }

  if (payload.type === 'job_finished') {
    channel.finished = true;
    setTimeout(() => channels.delete(jobId), RETAIN_AFTER_FINISH_MS).unref();
  }
}

function parseLastEventSeq(lastEventId: string | undefined): number {
  if (!lastEventId) return 0;
  const [boot, seq] = lastEventId.split('.');
  if (boot !== BOOT_ID) return 0;
  const parsed = Number(seq);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

// Returns null when this process holds no channel for the job (finished
// more than RETAIN_AFTER_FINISH_MS ago, or created by a previous process).
// The caller must then rely on the DB snapshot alone.
export function subscribeJobEvents(
  jobId: string,
  lastEventId: string | undefined,
  listener: Listener,
): JobSubscription | null {
  const channel = channels.get(jobId);
  if (!channel) return null;

  const afterSeq = parseLastEventSeq(lastEventId);
  const replay = channel.buffer.filter((event) => event.seq > afterSeq);
  channel.listeners.add(listener);
  return {
    replay,
    unsubscribe: () => {
      channel.listeners.delete(listener);
    },
  };
}
// Module component implementation.
