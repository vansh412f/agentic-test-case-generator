import crypto from 'node:crypto';
import { prisma } from '../db/client.ts';
import { safeWrite } from '../db/safeWrite.ts';

export type ServerEventLevel = 'warn' | 'error';

interface PendingEvent {
  level: ServerEventLevel;
  source: string;
  message: string;
  context: any;
  jobId: string | null;
  fingerprint: string;
  count: number;
  firstSeen: number;
  timer?: NodeJS.Timeout;
}

const pendingByFingerprint = new Map<string, PendingEvent>();

// Hourly write cap state (200 writes per hour)
let hourlyWrites = 0;
let hourWindowStart = Date.now();
let droppedCount = 0;

export function getDroppedCount(): number {
  return droppedCount;
}

export function resetHourlyLimitForTest(): void {
  hourlyWrites = 0;
  hourWindowStart = Date.now();
  droppedCount = 0;
}

export function normalizeMessage(msg: string): string {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/https?:\/\/[^\s"'`]+/gi, '<URL>')
    .replace(/\d+/g, '<NUM>')
    .trim();
}

export function computeFingerprint(source: string, msg: string): string {
  const norm = normalizeMessage(msg);
  return crypto.createHash('sha1').update(`${source}:${norm}`).digest('hex');
}

export function redactSensitiveText(text: string): string {
  if (!text) return '';

  let out = text;

  // 1. Strip query strings from URLs
  out = out.replace(/(https?:\/\/[^\s"'`?#]+)\?[^\s"'`#]*/gi, '$1');

  // 2. Redact known secrets from config / env if present
  const secretsToMask = [
    process.env.DATABASE_URL,
    process.env.DIRECT_URL,
    process.env.VISITOR_SIGNING_SECRET,
    process.env.POW_SECRET,
    process.env.ADMIN_SECRET,
    process.env.EDGE_SHARED_SECRET,
    process.env.GROQ_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.NVIDIA_API_KEY,
  ].filter((s): s is string => Boolean(s && s.length >= 8));

  for (const secret of secretsToMask) {
    out = out.split(secret).join('[REDACTED_SECRET]');
  }

  // 3. Redact common API keys and authorization headers
  out = out
    .replace(/gsk_[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/AIza[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/nvapi-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(?:password|secret|apiKey|api_key|token)["':\s=]+([^,\s}"'`]+)/gi, (m, val) =>
      m.replace(val, '[REDACTED]'),
    );

  return out;
}

export function redactContext(ctx: unknown): any {
  if (!ctx) return null;
  try {
    const rawStr = JSON.stringify(ctx, (_k, v) => {
      if (typeof v === 'string') {
        return redactSensitiveText(v);
      }
      return v;
    });

    const redactedStr = redactSensitiveText(rawStr);
    // Hard cap at 4 KB
    const cappedStr = redactedStr.length > 4096 ? redactedStr.slice(0, 4096) : redactedStr;
    return JSON.parse(cappedStr);
  } catch {
    return { error: 'Failed to serialize context' };
  }
}

async function writeEventToDb(event: PendingEvent): Promise<void> {
  const now = Date.now();
  if (now - hourWindowStart >= 3600_000) {
    hourWindowStart = now;
    hourlyWrites = 0;
  }

  if (hourlyWrites >= 200) {
    droppedCount += 1;
    return;
  }

  hourlyWrites += 1;

  await safeWrite('recordServerEvent', () =>
    prisma.serverEvent.create({
      data: {
        level: event.level,
        source: event.source,
        message: event.message,
        context: event.context,
        jobId: event.jobId,
        fingerprint: event.fingerprint,
        count: event.count,
      },
    }),
  );
}

export async function flushServerEvents(): Promise<void> {
  const events = [...pendingByFingerprint.values()];
  pendingByFingerprint.clear();

  for (const ev of events) {
    if (ev.timer) {
      clearTimeout(ev.timer);
    }
    await writeEventToDb(ev);
  }
}

async function flushSingleEvent(fingerprint: string): Promise<void> {
  const ev = pendingByFingerprint.get(fingerprint);
  if (!ev) return;
  pendingByFingerprint.delete(fingerprint);
  if (ev.timer) {
    clearTimeout(ev.timer);
  }
  await writeEventToDb(ev);
}

export function recordServerEvent(
  level: ServerEventLevel,
  source: string,
  errOrMessage: unknown,
  ctx?: Record<string, unknown>,
  jobId?: string,
): void {
  try {
    const rawMessage =
      typeof errOrMessage === 'string'
        ? errOrMessage
        : errOrMessage instanceof Error
          ? errOrMessage.message
          : String(errOrMessage ?? '');

    const redactedMessage = redactSensitiveText(rawMessage).slice(0, 500);
    const fingerprint = computeFingerprint(source, redactedMessage);

    const existing = pendingByFingerprint.get(fingerprint);
    const now = Date.now();

    if (existing && now - existing.firstSeen < 60_000) {
      existing.count += 1;
      return;
    }

    // Flushed on the next write: flush any existing pending events before registering the new one
    void flushServerEvents();

    const cleanContext = ctx ? redactContext(ctx) : null;

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validJobId = typeof jobId === 'string' && UUID_REGEX.test(jobId) ? jobId : null;

    const pending: PendingEvent = {
      level,
      source: source.slice(0, 100),
      message: redactedMessage,
      context: cleanContext,
      jobId: validJobId,
      fingerprint,
      count: 1,
      firstSeen: now,
    };

    pending.timer = setTimeout(() => {
      void flushSingleEvent(fingerprint);
    }, 60_000);
    pending.timer.unref();

    pendingByFingerprint.set(fingerprint, pending);
  } catch (err) {
    console.warn('[ServerEvents] Failed to record event:', err instanceof Error ? err.message : String(err));
  }
}
