import { AsyncLocalStorage } from 'node:async_hooks';

interface PersistenceState {
  available: boolean;
}

const storage = new AsyncLocalStorage<PersistenceState>();

export function withPersistence<T>(operation: () => Promise<T>): Promise<T> {
  return storage.run({ available: true }, operation);
}

export async function safeWrite<T>(name: string, operation: () => Promise<T>): Promise<T | undefined> {
  const state = storage.getStore();
  if (state && !state.available) return undefined;
  try {
    return await operation();
  } catch (error) {
    if (state) state.available = false;
    console.warn(`[Persistence] ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}
