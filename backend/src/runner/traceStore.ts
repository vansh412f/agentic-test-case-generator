import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.ts';
import { RUNNER_DIR } from './config.ts';
import { logger } from '../observability/logger.ts';

// Constants
export const TRACE_TTL_MS = 60 * 60_000; // 1 hour
export const MAX_TRACES = 200;
export const MAX_TOTAL_TRACE_BYTES = 256 * 1024 * 1024; // 256 MiB
export const MAX_TRACE_BYTES = 25 * 1024 * 1024; // 25 MB

// Trace registry entry
export interface TraceEntry {
  jobId: string;
  testCaseId: string;
  attemptNumber: number;
  visitorId: string;
  createdAt: number;
  expiresAt: number;
  sizeBytes: number;
  traceId: string;
}

// Registry: Map<traceId, TraceEntry>
const registry = new Map<string, TraceEntry>();

// Trace store directory: <RUNNER_DIR>/.traces
const TRACE_DIR = path.resolve(RUNNER_DIR, '.traces');

// Signing secret mirror from security/visitor.ts
function signingSecret(): string {
  if (config.VISITOR_SIGNING_SECRET) return config.VISITOR_SIGNING_SECRET;
  return createHmac('sha256', config.DATABASE_URL)
    .update('visitor-v1')
    .digest('hex');
}

/**
 * Pure helper to plan evictions given current entries and incoming trace size.
 * Entries are evaluated FIFO: oldest by createdAt first (with registry insertion order for ties).
 * Evicts until after adding new entry:
 * (currentCount - evictedCount + 1) <= maxTraces
 * AND
 * (currentTotalBytes - evictedBytes + newSizeBytes) <= maxTotalBytes
 */
export function planEvictions(
  entries: Iterable<TraceEntry>,
  newSizeBytes: number,
  maxTraces = MAX_TRACES,
  maxTotalBytes = MAX_TOTAL_TRACE_BYTES
): string[] {
  const entryList = Array.from(entries);
  let totalBytes = 0;
  for (const e of entryList) {
    totalBytes += e.sizeBytes;
  }
  let currentCount = entryList.length;

  // Stable sort by createdAt ascending (insertion order preserved on ties)
  const sorted = [...entryList].sort((a, b) => a.createdAt - b.createdAt);
  const evictedIds: string[] = [];

  for (const entry of sorted) {
    if (currentCount + 1 <= maxTraces && totalBytes + newSizeBytes <= maxTotalBytes) {
      break;
    }
    evictedIds.push(entry.traceId);
    currentCount--;
    totalBytes -= entry.sizeBytes;
  }

  return evictedIds;
}

/**
 * Inspection helper returning registry count and total retained bytes.
 */
export function getTraceStats(): { count: number; totalBytes: number } {
  let totalBytes = 0;
  for (const entry of registry.values()) {
    totalBytes += entry.sizeBytes;
  }
  return { count: registry.size, totalBytes };
}

/**
 * Register a trace zip file in the store.
 * Returns the traceId on success, null on failure.
 */
export async function registerTrace(
  srcZipPath: string,
  meta: { jobId: string; testCaseId: string; attemptNumber: number; visitorId: string }): Promise<string | null> {
  try {
    const srcSize = await fs.stat(srcZipPath).then(stat => stat.size);

    // Check size limit
    if (srcSize > MAX_TRACE_BYTES) {
      logger.warn(`Trace file exceeds MAX_TRACE_BYTES (${srcSize} > ${MAX_TRACE_BYTES}); rejecting.`, {
        component: 'TraceStore',
        sizeBytes: srcSize,
        maxBytes: MAX_TRACE_BYTES,
      });
      return null;
    }

    // Generate traceId and destination path
    const traceId = randomUUID();
    const destPath = path.join(TRACE_DIR, `${traceId}.zip`);

    // Ensure trace dir exists
    await fs.mkdir(TRACE_DIR, { recursive: true });

    // Replace duplicate entry for same (jobId, testCaseId, attemptNumber, visitorId)
    for (const [existingId, existingEntry] of registry) {
      if (
        existingEntry.jobId === meta.jobId &&
        existingEntry.testCaseId === meta.testCaseId &&
        existingEntry.attemptNumber === meta.attemptNumber &&
        existingEntry.visitorId === meta.visitorId
      ) {
        const oldFile = path.join(TRACE_DIR, `${existingId}.zip`);
        try {
          await fs.unlink(oldFile);
        } catch {
          // Ignore cleanup errors
        }
        registry.delete(existingId);
      }
    }

    // Evict oldest by createdAt (FIFO) and byte ceiling before copying new trace
    const toEvict = planEvictions(registry.values(), srcSize);
    for (const evictId of toEvict) {
      const evictFile = path.join(TRACE_DIR, `${evictId}.zip`);
      try {
        await fs.unlink(evictFile);
      } catch {
        // Ignore cleanup errors
      }
      registry.delete(evictId);
    }

    // Copy zip to store
    await fs.copyFile(srcZipPath, destPath);

    // Set registry entry
    const now = Date.now();
    const entry: TraceEntry = {
      jobId: meta.jobId,
      testCaseId: meta.testCaseId,
      attemptNumber: meta.attemptNumber,
      visitorId: meta.visitorId,
      createdAt: now,
      expiresAt: now + TRACE_TTL_MS,
      sizeBytes: srcSize,
      traceId,
    };

    registry.set(traceId, entry);

    return traceId;
  } catch (err) {
    logger.warn('registerTrace failed', {
      component: 'TraceStore',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Get a trace entry by traceId.
 * Returns { entry, filePath } or null if missing/expired.
 */
export function getTrace(traceId: string): { entry: TraceEntry; filePath: string } | null {
  const entry = registry.get(traceId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    // Lazily delete expired entry + file
    try {
    const traceFile = path.join(TRACE_DIR, `${traceId}.zip`);
      fsSync.unlinkSync(traceFile);
    } catch {
      // Ignore
    }
    registry.delete(traceId);
    return null;
  }
  const filePath = path.join(TRACE_DIR, `${traceId}.zip`);
  return { entry, filePath };
}

/**
 * Get trace entry ONLY if visitorId matches and not expired.
 * Owner-only gate.
 */
export function traceForAttempt(
  jobId: string,
  testCaseId: string,
  attemptNumber: number,
  viewerVisitorId: string): TraceEntry | null {
  // Linear scan - bounded by TTL + max entries
  for (const [, entry] of registry) {
    if (
      entry.jobId === jobId &&
      entry.testCaseId === testCaseId &&
      entry.attemptNumber === attemptNumber &&
      entry.visitorId === viewerVisitorId &&
      Date.now() <= entry.expiresAt
    ) {
      return entry;
    }
  }
  return null;
}

/**
 * Sign a trace token: `${exp}.${sig}` where exp = Date.now() + ttlMs (ms epoch, base10 string),
 * sig = HMAC(secret, `trace:${traceId}:${visitorId}:${exp}`).
 */
export function signTraceToken(
  traceId: string,
  visitorId: string,
  ttlMs = 10 * 60_000): string {
  const exp = Date.now() + ttlMs;
  const sig = createHmac('sha256', signingSecret())
    .update(`trace:${traceId}:${visitorId}:${exp}`)
    .digest('base64url');
  return `${exp}.${sig}`;
}

/**
 * Verify a trace token.
 * Returns true if valid, false if missing/expired/tampered.
 * The visitorId is NEVER in the URL — it comes from the registry entry.
 */
export function verifyTraceToken(traceId: string, token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const expStr = parts[0];
  const sig = parts[1];

  const exp = Number(expStr);
  if (Number.isNaN(exp) || Date.now() > exp) return false;

  // Look up entry for traceId
  const entry = registry.get(traceId);
  if (!entry) return false;

  // Recompute sig with ENTRY.visitorId; timingSafeEqual guard lengths
  const expectedSig = createHmac('sha256', signingSecret())
    .update(`trace:${traceId}:${entry.visitorId}:${expStr}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  return true;
}

/**
 * Initialize the trace store:
 * - mkdir .traces dir
 * - delete ALL files in dir (boot = clean slate, registry is empty anyway)
 * - start setInterval sweep every 10 min (delete expired entries+files) with .unref()
 * - Log one line: [TraceStore] ready at <dir> (ttl 1h)
 */
export async function initTraceStore(): Promise<void> {
  await fs.mkdir(TRACE_DIR, { recursive: true });

  // Boot: clean slate - delete all files in dir
  try {
    const entries = await fs.readdir(TRACE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      try {
        await fs.unlink(path.join(TRACE_DIR, entry.name));
      } catch {
        // Ignore
      }
    }
  } catch {
    // Dir may be empty; fine
  }

  // Reset registry
  registry.clear();

  // Start sweep interval every 10 minutes
  setInterval(async () => {
    const now = Date.now();
    for (const [traceId, entry] of registry) {
      if (now > entry.expiresAt) {
        try {
          const traceFile = path.join(TRACE_DIR, `${traceId}.zip`);
          fsSync.unlinkSync(traceFile);
        } catch {
          // Ignore
        }
        registry.delete(traceId);
      }
    }
  }, 10 * 60_000).unref();

  logger.info(`ready at ${TRACE_DIR} (ttl 1h)`, {
    component: 'TraceStore',
    traceDir: TRACE_DIR,
    maxTraces: MAX_TRACES,
    maxBytes: MAX_TOTAL_TRACE_BYTES,
  });
}