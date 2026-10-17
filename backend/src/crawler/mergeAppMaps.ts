import { AppMapSchema, type AppMap, type Form, type InteractiveElement } from './types.ts';

export interface CrawledPage { requestedUrl: string; map: AppMap; }

const SKIP_PATH = /(log-?out|sign-?out|delete|unsubscribe|\.(pdf|zip|gz|dmg|exe|png|jpe?g|gif|svg|webp|mp4|mp3|csv|xlsx?|docx?))$/i;

export function canonicalPageUrl(url: string, base?: string): string {
  try {
    const parsed = new URL(url, base);
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return url;
  }
}

export function pickDeepCrawlLinks(start: AppMap, count: number): string[] {
  if (count <= 0) return [];
  const seen = new Set<string>([canonicalPageUrl(start.url)]);
  const picked: string[] = [];
  for (const link of start.discoveredLinks) {
    const key = canonicalPageUrl(link);
    if (seen.has(key)) continue;
    seen.add(key);
    if (SKIP_PATH.test(new URL(link).pathname)) continue;
    picked.push(link);
    if (picked.length >= count) break;
  }
  return picked;
}

// IDs stay globally sequential (elem-1..N) so knownIds + generator scoping are unchanged.
// Only extra-page elements carry `page`, so single-page maps pay zero extra tokens.
export function mergeAppMaps(start: AppMap, extras: CrawledPage[]): AppMap {
  if (extras.length === 0) return start;
  let nextId = 1;
  const elements: InteractiveElement[] = [];
  const forms: Form[] = [];
  const pages: Array<{ url: string; requestedUrl: string; title: string }> = [];

  const append = (map: AppMap, requestedUrl: string, pageNumber: number) => {
    const idMap = new Map<string, string>();
    for (const element of map.elements) {
      const id = `elem-${nextId++}`;
      idMap.set(element.id, id);
      elements.push(pageNumber === 1 ? { ...element, id } : { ...element, id, page: pageNumber });
    }
    for (const form of map.forms) {
      forms.push({
        ...form,
        id: pageNumber === 1 ? form.id : `p${pageNumber}-${form.id}`,
        fieldIds: form.fieldIds.map((id) => idMap.get(id)).filter((id): id is string => id !== undefined),
        submitButtonId: form.submitButtonId ? idMap.get(form.submitButtonId) ?? null : null,
      });
    }
    pages.push({ url: map.url, requestedUrl, title: map.title });
  };

  append(start, start.url, 1);
  extras.forEach((extra, index) => append(extra.map, extra.requestedUrl, index + 2));

  const crawled = new Set(pages.flatMap((p) => [canonicalPageUrl(p.url), canonicalPageUrl(p.requestedUrl)]));
  const discoveredLinks = [...new Set([start, ...extras.map((e) => e.map)].flatMap((m) => m.discoveredLinks))]
    .filter((link) => !crawled.has(canonicalPageUrl(link)));

  return AppMapSchema.parse({
    ...start, elements, forms, discoveredLinks, pages,
    totalElementsFound: start.totalElementsFound + extras.reduce((sum, e) => sum + e.map.totalElementsFound, 0),
    isTruncated: start.isTruncated || extras.some((e) => e.map.isTruncated),
  });
}
