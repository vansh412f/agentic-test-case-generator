import { createHash } from 'node:crypto';

export type KeyCheckStatus = 'valid' | 'invalid' | 'unknown';

interface CacheEntry {
  status: KeyCheckStatus;
  expiresAt: number;
}

const VALID_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const INVALID_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 500;

// Key hash -> CacheEntry (in insertion order for LRU/oldest eviction)
const keyCheckCache = new Map<string, CacheEntry>();

function hashProviderKey(provider: 'groq' | 'gemini', key: string): string {
  return createHash('sha256').update(`${provider}:${key}`).digest('hex');
}

function getCachedStatus(hash: string, now: number): KeyCheckStatus | null {
  const entry = keyCheckCache.get(hash);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    keyCheckCache.delete(hash);
    return null;
  }
  return entry.status;
}

function setCachedStatus(hash: string, status: KeyCheckStatus, now: number): void {
  if (status === 'unknown') {
    return; // Do not cache transient outages or unknown results
  }

  // Evict oldest if at capacity
  if (keyCheckCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = keyCheckCache.keys().next().value;
    if (oldestKey !== undefined) {
      keyCheckCache.delete(oldestKey);
    }
  }

  const ttl = status === 'valid' ? VALID_CACHE_TTL_MS : INVALID_CACHE_TTL_MS;
  keyCheckCache.set(hash, {
    status,
    expiresAt: now + ttl,
  });
}

export function clearKeyCheckCacheForTest(): void {
  keyCheckCache.clear();
}

export async function checkProviderKey(
  provider: 'groq' | 'gemini',
  key: string,
): Promise<KeyCheckStatus> {
  const trimmed = key.trim();
  if (!trimmed) {
    return 'invalid';
  }

  const now = Date.now();
  const hash = hashProviderKey(provider, trimmed);
  const cached = getCachedStatus(hash, now);
  if (cached) {
    return cached;
  }

  const endpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/models'
    : 'https://generativelanguage.googleapis.com/v1beta/openai/models';

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${trimmed}`,
      },
      signal: AbortSignal.timeout(8000),
    });

    let status: KeyCheckStatus;
    if (response.ok) {
      status = 'valid';
    } else if (response.status === 400 || response.status === 401 || response.status === 403) {
      status = 'invalid';
    } else {
      status = 'unknown';
    }

    setCachedStatus(hash, status, now);
    return status;
  } catch {
    return 'unknown';
  }
}
