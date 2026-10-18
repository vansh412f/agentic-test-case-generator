export interface RememberedFieldEntry {
  fieldId: string;
  css?: string;
  name?: string;
  label?: string;
  value: string;
  sensitive: boolean;
}

export interface OriginRememberedData {
  origin: string;
  savedAt: number;
  entries: RememberedFieldEntry[];
}

const STORAGE_KEY = 'atsg-remembered-test-data';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function getOrigin(urlStr: string): string {
  try {
    return new URL(urlStr).origin;
  } catch {
    return urlStr;
  }
}

export function loadAllRemembered(): Record<string, OriginRememberedData> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const now = Date.now();
    const clean: Record<string, OriginRememberedData> = {};
    for (const [origin, data] of Object.entries(parsed)) {
      if (
        data &&
        typeof data === 'object' &&
        typeof (data as OriginRememberedData).savedAt === 'number' &&
        now - (data as OriginRememberedData).savedAt < THIRTY_DAYS_MS &&
        Array.isArray((data as OriginRememberedData).entries)
      ) {
        clean[origin] = data as OriginRememberedData;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveAllRemembered(all: Record<string, OriginRememberedData>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export function saveRememberedTestData(
  targetUrl: string,
  entries: Record<string, { value: string; sensitive: boolean }>,
  elements: Array<{
    id: string;
    name?: string | null;
    placeholder?: string | null;
    ariaLabel?: string | null;
    text?: string | null;
    selectors?: { css: string };
  }>,
): void {
  const origin = getOrigin(targetUrl);
  const fieldEntries: RememberedFieldEntry[] = [];

  for (const [fieldId, entry] of Object.entries(entries)) {
    if (!entry.value.trim()) continue;
    const el = elements.find((e) => e.id === fieldId);
    fieldEntries.push({
      fieldId,
      css: el?.selectors?.css,
      name: el?.name ?? undefined,
      label: el?.ariaLabel ?? el?.placeholder ?? el?.name ?? el?.text ?? undefined,
      value: entry.value,
      sensitive: entry.sensitive,
    });
  }

  const all = loadAllRemembered();
  if (fieldEntries.length === 0) {
    delete all[origin];
  } else {
    all[origin] = {
      origin,
      savedAt: Date.now(),
      entries: fieldEntries,
    };
  }
  saveAllRemembered(all);
}

export function loadRememberedTestData(
  targetUrl: string,
  elements: Array<{
    id: string;
    name?: string | null;
    placeholder?: string | null;
    ariaLabel?: string | null;
    text?: string | null;
    inputType?: string | null;
    selectors?: { css: string };
  }>,
): Record<string, { value: string; sensitive: boolean }> {
  const origin = getOrigin(targetUrl);
  const all = loadAllRemembered();
  const originData = all[origin];
  if (!originData) return {};

  const result: Record<string, { value: string; sensitive: boolean }> = {};

  for (const el of elements) {
    const label = el.ariaLabel ?? el.placeholder ?? el.name ?? el.text ?? el.id;
    const match = originData.entries.find(
      (e) =>
        (el.selectors?.css && e.css === el.selectors.css) ||
        (el.name && e.name === el.name) ||
        e.fieldId === el.id ||
        (e.label && e.label === label),
    );
    if (match) {
      result[el.id] = {
        value: match.value,
        sensitive: match.sensitive ?? (el.inputType === 'password'),
      };
    }
  }

  return result;
}

export function hasRememberedTestData(targetUrl: string): boolean {
  const origin = getOrigin(targetUrl);
  const all = loadAllRemembered();
  return Boolean(all[origin] && all[origin].entries.length > 0);
}

export function forgetRememberedTestData(targetUrl: string): void {
  const origin = getOrigin(targetUrl);
  const all = loadAllRemembered();
  delete all[origin];
  saveAllRemembered(all);
}

export function forgetAllRememberedTestData(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
