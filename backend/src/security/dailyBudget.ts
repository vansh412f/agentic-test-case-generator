import { createHmac } from 'node:crypto';
import { ipKeyGenerator } from 'express-rate-limit';
import { prisma } from '../db/client.ts';
import { config } from '../config.ts';

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function nextUtcMidnight(now = new Date()): Date {
  const d = startOfUtcDay(now);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export function ipHashFor(ip: string, now = new Date()): string {
  const baseSecret =
    config.VISITOR_SIGNING_SECRET ||
    createHmac('sha256', config.DATABASE_URL).update('visitor-v1').digest('hex');
  const key = createHmac('sha256', baseSecret).update('ip-hash-v1').digest();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const normalized = ipKeyGenerator(ip);
  return createHmac('sha256', key)
    .update(`${dateStr}|${normalized}`)
    .digest('hex')
    .slice(0, 32);
}

export interface BudgetCounts {
  global: number;
  visitor: number;
  ip: number;
}

export type BudgetCountProvider = (params: {
  visitorId: string | null;
  ipHash: string | null;
  now: Date;
}) => Promise<BudgetCounts>;

let customCountProvider: BudgetCountProvider | null = null;

export function setBudgetCountProviderForTest(fn: BudgetCountProvider | null): void {
  customCountProvider = fn;
}

export async function countJobsForBudget(
  visitorId: string | null,
  ipHash: string | null,
  now = new Date(),
): Promise<BudgetCounts> {
  if (customCountProvider) {
    return customCountProvider({ visitorId, ipHash, now });
  }

  const baseWhere = {
    createdAt: { gte: startOfUtcDay(now) },
    usedOwnKeys: false,
    quotaExempt: false,
    NOT: [
      {
        status: 'cancelled' as const,
        startedAt: null,
      },
      {
        errorCode: { not: null, in: ['SERVER_RESTART', 'SERVER_SHUTDOWN'] },
      },
    ],
  };

  const [globalCount, visitorCount, ipCount] = await Promise.all([
    prisma.job.count({ where: baseWhere }),
    visitorId
      ? prisma.job.count({ where: { ...baseWhere, visitorId } })
      : Promise.resolve(0),
    ipHash
      ? prisma.job.count({ where: { ...baseWhere, ipHash } })
      : Promise.resolve(0),
  ]);

  return {
    global: globalCount,
    visitor: visitorCount,
    ip: ipCount,
  };
}

let reservedGlobal = 0;
const reservedVisitor = new Map<string, number>();
const reservedIp = new Map<string, number>();
let reservationMutex: Promise<unknown> = Promise.resolve();

export function getReservedCounts(): {
  global: number;
  visitor: Map<string, number>;
  ip: Map<string, number>;
} {
  return {
    global: reservedGlobal,
    visitor: new Map(reservedVisitor),
    ip: new Map(reservedIp),
  };
}

export function resetReservationsForTest(): void {
  reservedGlobal = 0;
  reservedVisitor.clear();
  reservedIp.clear();
  reservationMutex = Promise.resolve();
}

export interface ReserveRunParams {
  visitorId: string | null;
  ipHash: string;
  n: number;
  now?: Date;
}

export type ReserveRunResult =
  | { ok: true; release(): void }
  | {
      ok: false;
      reason: 'quota_exhausted';
      scope: 'global' | 'visitor' | 'ip';
      limit: number;
      used: number;
      resetsAt: string;
    }
  | {
      ok: false;
      reason: 'unavailable';
    };

export async function tryReserveRun({
  visitorId,
  ipHash,
  n,
  now = new Date(),
}: ReserveRunParams): Promise<ReserveRunResult> {
  return new Promise<ReserveRunResult>((resolve) => {
    reservationMutex = reservationMutex.then(async () => {
      try {
        const counts = await countJobsForBudget(visitorId, ipHash, now);
        const resetsAt = nextUtcMidnight(now).toISOString();

        // 1. Check visitor scope
        if (visitorId) {
          const limit = config.FREE_VISITOR_DAILY_LIMIT;
          const used = counts.visitor + (reservedVisitor.get(visitorId) ?? 0);
          if (used + n > limit) {
            resolve({ ok: false, reason: 'quota_exhausted', scope: 'visitor', limit, used, resetsAt });
            return;
          }
        }

        // 2. Check IP scope
        if (ipHash) {
          const limit = config.FREE_IP_DAILY_LIMIT;
          const used = counts.ip + (reservedIp.get(ipHash) ?? 0);
          if (used + n > limit) {
            resolve({ ok: false, reason: 'quota_exhausted', scope: 'ip', limit, used, resetsAt });
            return;
          }
        }

        // 3. Check global scope
        {
          const limit = config.GENERATE_DAILY_LIMIT;
          const used = counts.global + reservedGlobal;
          if (used + n > limit) {
            resolve({ ok: false, reason: 'quota_exhausted', scope: 'global', limit, used, resetsAt });
            return;
          }
        }

        // All passed -> reserve atomically
        if (visitorId) {
          reservedVisitor.set(visitorId, (reservedVisitor.get(visitorId) ?? 0) + n);
        }
        if (ipHash) {
          reservedIp.set(ipHash, (reservedIp.get(ipHash) ?? 0) + n);
        }
        reservedGlobal += n;

        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          reservationMutex = reservationMutex.then(() => {
            if (visitorId) {
              const cur = (reservedVisitor.get(visitorId) ?? 0) - n;
              if (cur <= 0) reservedVisitor.delete(visitorId);
              else reservedVisitor.set(visitorId, cur);
            }
            if (ipHash) {
              const cur = (reservedIp.get(ipHash) ?? 0) - n;
              if (cur <= 0) reservedIp.delete(ipHash);
              else reservedIp.set(ipHash, cur);
            }
            reservedGlobal = Math.max(0, reservedGlobal - n);
          });
        };

        resolve({ ok: true, release });
      } catch (_err) {
        resolve({
          ok: false,
          reason: 'unavailable',
        });
      }
    });
  });
}

export interface BudgetScopeStatus {
  scope: 'global' | 'visitor' | 'ip';
  limit: number;
  used: number;
}

export interface BudgetStatusResult {
  scopes: BudgetScopeStatus[];
  remaining: number;
  resetsAt: string;
}

export async function budgetStatus({
  visitorId,
  ipHash,
  now = new Date(),
}: {
  visitorId: string | null;
  ipHash: string;
  now?: Date;
}): Promise<BudgetStatusResult> {
  const counts = await countJobsForBudget(visitorId, ipHash, now);
  const resetsAt = nextUtcMidnight(now).toISOString();

  const scopes: BudgetScopeStatus[] = [];

  const visitorLimit = config.FREE_VISITOR_DAILY_LIMIT;
  const visitorUsed = counts.visitor + (visitorId ? (reservedVisitor.get(visitorId) ?? 0) : 0);
  scopes.push({ scope: 'visitor', limit: visitorLimit, used: visitorUsed });

  const ipLimit = config.FREE_IP_DAILY_LIMIT;
  const ipUsed = counts.ip + (ipHash ? (reservedIp.get(ipHash) ?? 0) : 0);
  scopes.push({ scope: 'ip', limit: ipLimit, used: ipUsed });

  const globalLimit = config.GENERATE_DAILY_LIMIT;
  const globalUsed = counts.global + reservedGlobal;
  scopes.push({ scope: 'global', limit: globalLimit, used: globalUsed });

  const remainingVisitor = visitorId ? Math.max(0, visitorLimit - visitorUsed) : visitorLimit;
  const remainingIp = ipHash ? Math.max(0, ipLimit - ipUsed) : ipLimit;
  const remainingGlobal = Math.max(0, globalLimit - globalUsed);

  const remaining = Math.min(remainingVisitor, remainingIp, remainingGlobal);

  return { scopes, remaining, resetsAt };
}
