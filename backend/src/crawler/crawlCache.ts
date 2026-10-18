import type { AppMap } from './types.ts';

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 20;

export function normalizeCrawlKey(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const port =
      (u.port === '80' && u.protocol === 'http:') ||
      (u.port === '443' && u.protocol === 'https:') ||
      !u.port
        ? ''
        : `:${u.port}`;
    let pathname = u.pathname.replace(/\/+$/, '');
    if (!pathname && u.search) pathname = '';
    return `${u.protocol}//${host}${port}${pathname}${u.search}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, '');
  }
}

interface CacheEntry {
  appMap: AppMap;
  storedAt: number;
  aliases: Set<string>;
}

const entries = new Map<string, CacheEntry>();

export function rememberCrawl(requestedUrl: string, appMap: AppMap): void {
  const reqKey = normalizeCrawlKey(requestedUrl);
  const finalKey = normalizeCrawlKey(appMap.url);
  const aliases = new Set([reqKey, finalKey]);

  for (const a of aliases) {
    const old = entries.get(a);
    if (old) {
      for (const oldAlias of old.aliases) entries.delete(oldAlias);
    }
  }

  const entry: CacheEntry = {
    appMap,
    storedAt: Date.now(),
    aliases,
  };

  for (const a of aliases) {
    entries.set(a, entry);
  }

  const uniqueEntries = new Set(entries.values());
  while (uniqueEntries.size > MAX_ENTRIES) {
    let oldest: CacheEntry | null = null;
    for (const e of uniqueEntries) {
      if (!oldest || e.storedAt < oldest.storedAt) oldest = e;
    }
    if (!oldest) break;
    for (const a of oldest.aliases) entries.delete(a);
    uniqueEntries.delete(oldest);
  }
}

export function takeFreshCrawl(url: string, maxAgeMs = TTL_MS): AppMap | null {
  const key = normalizeCrawlKey(url);
  const entry = entries.get(key);
  if (!entry) return null;

  const age = Date.now() - entry.storedAt;
  if (age > maxAgeMs) {
    for (const a of entry.aliases) entries.delete(a);
    return null;
  }

  // Deletes both aliases upon taking
  for (const a of entry.aliases) entries.delete(a);
  return structuredClone(entry.appMap);
}

export function clearCrawlCache(): void {
  entries.clear();
}
