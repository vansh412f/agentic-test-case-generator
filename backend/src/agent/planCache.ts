import crypto from 'node:crypto';
import type { TestPlan } from './prompts/plannerPrompt.ts';

interface CacheEntry {
  plan: TestPlan;
  expiresAt: number;
}

const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_ENTRIES = 30;

export const planCache = new Map<string, CacheEntry>();

export function buildPlanCacheKey(params: {
  view: unknown;
  data?: unknown;
  focus?: unknown;
  observations?: unknown;
}): string {
  const payload = JSON.stringify({
    v: 3,
    view: params.view,
    data: params.data ?? null,
    focus: params.focus ?? null,
    observations: params.observations ?? null,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function getCachedPlan(key: string): TestPlan | null {
  const entry = planCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    planCache.delete(key);
    return null;
  }
  return structuredClone(entry.plan);
}

export function setCachedPlan(key: string, plan: TestPlan): void {
  // Evict oldest if reaching capacity
  if (planCache.size >= MAX_ENTRIES && !planCache.has(key)) {
    const oldestKey = planCache.keys().next().value;
    if (oldestKey !== undefined) {
      planCache.delete(oldestKey);
    }
  }
  planCache.set(key, {
    plan: structuredClone(plan),
    expiresAt: Date.now() + TTL_MS,
  });
}

export function clearPlanCache(): void {
  planCache.clear();
}
// Module component implementation.
