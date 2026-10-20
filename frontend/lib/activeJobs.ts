export interface ActiveJobItem {
  id: string;
  url: string;
  addedAt: number;
}

const STORAGE_KEY = 'atsg-active-jobs';
const CUSTOM_EVENT_NAME = 'atsg-active-jobs';
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function readActiveJobs(): ActiveJobItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const valid = parsed.filter(
      (item): item is ActiveJobItem =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.url === 'string' &&
        typeof item.addedAt === 'number' &&
        now - item.addedAt < TWO_HOURS_MS,
    );
    if (valid.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

function writeActiveJobs(items: ActiveJobItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENT_NAME, { detail: items }));
  } catch {
    // Ignore localStorage write failures
  }
}

export function trackJobs(ids: string[], urls: string[]): void {
  if (typeof window === 'undefined' || ids.length === 0) return;
  const current = readActiveJobs();
  const existingMap = new Set(current.map((j) => j.id));
  const now = Date.now();

  const additions: ActiveJobItem[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!existingMap.has(id)) {
      additions.push({
        id,
        url: urls[i] ?? urls[0] ?? '',
        addedAt: now,
      });
      existingMap.add(id);
    }
  }

  if (additions.length > 0) {
    writeActiveJobs([...current, ...additions]);
  }
}

export function untrackJob(id: string): void {
  if (typeof window === 'undefined') return;
  const current = readActiveJobs();
  const next = current.filter((j) => j.id !== id);
  if (next.length !== current.length) {
    writeActiveJobs(next);
  }
}

export function subscribe(listener: (jobs: ActiveJobItem[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      listener(readActiveJobs());
    }
  };

  const handleCustom = (event: Event) => {
    const custom = event as CustomEvent<ActiveJobItem[]>;
    listener(custom.detail ?? readActiveJobs());
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(CUSTOM_EVENT_NAME, handleCustom);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(CUSTOM_EVENT_NAME, handleCustom);
  };
}
