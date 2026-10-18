import type { Request, Response } from 'express';
import { z } from 'zod';
import type { JobStatus } from '@prisma/client';
import { getJobStatus } from '../db/jobs.ts';
import { subscribeJobEvents, type JobEvent } from '../agent/jobEvents.ts';
import { toHttpError } from './errors.ts';

const HEARTBEAT_MS = 15_000;
const CLIENT_RETRY_MS = 3_000;
const JobIdSchema = z.object({ id: z.string().uuid() });

const activeStreams = new Set<() => void>();

export function closeAllJobStreams(): void {
  for (const close of [...activeStreams]) close();
}

function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function writeEvent(res: Response, event: string, data: unknown, id?: string): void {
  res.write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Protocol: every connection starts with a DB-derived `snapshot`, then the
// in-memory replay (filtered by Last-Event-ID), then live events. Events are
// idempotent invalidation signals; the client refetches GET /api/jobs/:id.
// `unavailable` = this process has no live channel for a non-terminal job;
// the client must fall back to polling instead of reconnecting.
export async function handleJobStream(req: Request, res: Response): Promise<void> {
  const parsed = JobIdSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'Request validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const jobId = parsed.data.id;

  // Subscribe BEFORE the DB read so events published during the read are queued, not lost.
  const pending: JobEvent[] = [];
  let deliver: ((event: JobEvent) => void) | null = null;
  const subscription = subscribeJobEvents(jobId, req.header('last-event-id'), (event) => {
    if (deliver) deliver(event);
    else pending.push(event);
  });

  let snapshot: Awaited<ReturnType<typeof getJobStatus>>;
  try {
    snapshot = await getJobStatus(jobId);
  } catch (error) {
    subscription?.unsubscribe();
    const mapped = toHttpError(error);
    if (mapped) {
      res.status(mapped.status).json(mapped.body);
      return;
    }
    throw error;
  }

  if (!snapshot) {
    subscription?.unsubscribe();
    res.status(404).json({ error: 'JOB_NOT_FOUND', message: 'Job not found.' });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  // no-transform stops compression middleware (incl. Next's rewrite proxy) from buffering the stream.
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`retry: ${CLIENT_RETRY_MS}\n\n`);
  writeEvent(res, 'snapshot', { jobId, status: snapshot.status, errorCode: snapshot.errorCode });

  let closed = false;
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    subscription?.unsubscribe();
    activeStreams.delete(close);
    if (!res.writableEnded) res.end();
  };
  activeStreams.add(close);
  res.on('close', close);

  if (!subscription) {
    if (isTerminal(snapshot.status)) {
      writeEvent(res, 'job_finished', { status: snapshot.status, errorCode: snapshot.errorCode });
    } else {
      writeEvent(res, 'unavailable', { jobId });
    }
    close();
    return;
  }

  const backlog = [...subscription.replay, ...pending.filter((e) => !subscription.replay.some((r) => r.seq === e.seq))];
  for (const event of backlog) writeEvent(res, event.type, event.data, event.id);

  if (backlog.some((event) => event.type === 'job_finished')) {
    close();
    return;
  }
  if (isTerminal(snapshot.status)) {
    // Terminal in DB without a published job_finished (shutdown/reconcile path).
    writeEvent(res, 'job_finished', { status: snapshot.status, errorCode: snapshot.errorCode });
    close();
    return;
  }

  deliver = (event) => {
    if (closed) return;
    writeEvent(res, event.type, event.data, event.id);
    if (event.type === 'job_finished') close();
  };
}
