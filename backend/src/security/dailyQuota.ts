/**
 * Daily quota tracking for free-tier demo runs.
 *
 * Uses a direct Prisma count query against the Job table (read-only aggregate).
 * This survives server restarts and cold boots, unlike in-memory counters.
 *
 * In-flight requests hold an in-memory reservation to close TOCTOU races.
 * This does not need DB transactions; the concurrency gate already bounds
 * in-flight work at 2, and single-instance in-memory reservations are
 * correct for the Render single-instance deployment.
 */
import { prisma } from '../db/client.ts';
import { config } from '../config.ts';

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type JobCountProvider = () => Promise<number>;
let jobCountProvider: JobCountProvider = () =>
  prisma.job.count({ where: { createdAt: { gte: startOfUtcDay() }, usedOwnKeys: false } });

export function setJobCountProviderForTest(fn: JobCountProvider | null): void {
  jobCountProvider = fn ?? (() => prisma.job.count({ where: { createdAt: { gte: startOfUtcDay() }, usedOwnKeys: false } }));
}

export async function jobsCreatedToday(): Promise<number> {
  return jobCountProvider();
}

export function nextUtcMidnight(now = new Date()): Date {
  const d = startOfUtcDay(now);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

let reserved = 0;
let reservationMutex: Promise<unknown> = Promise.resolve();

export function getReservedCount(): number {
  return reserved;
}

export function releaseReservation(n: number): void {
  reserved = Math.max(0, reserved - n);
}

/**
 * Atomically checks jobsCreatedToday() + reserved + n <= limit,
 * and if true, increments reserved by n before returning true.
 */
export async function tryReserve(
  n: number,
  limit = config.GENERATE_DAILY_LIMIT,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    reservationMutex = reservationMutex.then(async () => {
      try {
        const dbCount = await jobsCreatedToday();
        if (dbCount + reserved + n <= limit) {
          reserved += n;
          resolve(true);
        } else {
          resolve(false);
        }
      } catch {
        resolve(false);
      }
    });
  });
}
