/**
 * Daily quota tracking for free-tier demo runs.
 *
 * Uses a direct Prisma count query against the Job table (read-only aggregate).
 * This survives server restarts and cold boots, unlike in-memory counters.
 */
import { prisma } from '../db/client.ts';

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function jobsCreatedToday(): Promise<number> {
  return prisma.job.count({ where: { createdAt: { gte: startOfUtcDay() } } });
}

export function nextUtcMidnight(now = new Date()): Date {
  const d = startOfUtcDay(now);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
