import type { AppMap } from './types.ts';
import { canonicalPageUrl } from './mergeAppMaps.ts';

// Preview crawl and pipeline crawl hit the same URL seconds apart: reuse saves one
// Chromium launch per job on a 512 MB instance.
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 20;
const entries = new Map<string, { appMap: AppMap; storedAt: number }>();

export function rememberCrawl(requestedUrl: string, appMap: AppMap): void {
  const entry = { appMap, storedAt: Date.now() };
  for (const key of new Set([canonicalPageUrl(requestedUrl), canonicalPageUrl(appMap.url)])) {
    entries.delete(key);
    entries.set(key, entry);
  }
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function takeFreshCrawl(url: string): AppMap | null {
  const key = canonicalPageUrl(url);
  const entry = entries.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > TTL_MS) { entries.delete(key); return null; }
  return structuredClone(entry.appMap);
}

export function clearCrawlCache(): void { entries.clear(); }
