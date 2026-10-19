import { AsyncLocalStorage } from 'node:async_hooks';

interface PersistenceState {
  available: boolean;
}

const storage = new AsyncLocalStorage<PersistenceState>();

const TRANSIENT_PRISMA_CODES = new Set([
  'P1001', // Can't reach database server
  'P1002', // Database server timed out
  'P1008', // Operations timed out
  'P1017', // Server has closed the connection
  'P2024', // Timed out fetching a new connection from the pool
]);

const TRANSIENT_MESSAGE_REGEX = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|Connection terminated/;

export function isTransientError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_PRISMA_CODES.has(code)) {
      return true;
    }
    const name = (error as { name?: unknown }).name;
    if (name === 'PrismaClientInitializationError') {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_MESSAGE_REGEX.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function withPersistence<T>(operation: () => Promise<T>): Promise<T> {
  return storage.run({ available: true }, operation);
}

export function isBreakerOpen(): boolean {
  const state = storage.getStore();
  return Boolean(state && !state.available);
}

export interface SafeWriteOptions {
  critical?: boolean;
}

export async function safeWrite<T>(
  name: string,
  operation: () => Promise<T>,
  options?: SafeWriteOptions,
): Promise<T | undefined> {
  const state = storage.getStore();

  // Critical operations bypass an open breaker and retry 3x (0.5s / 1s / 2s)
  if (options?.critical) {
    const delays = [500, 1000, 2000];
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        attempt++;
        if (attempt > delays.length) {
          console.error(
            `[Persistence] ${name} failed (critical, final attempt ${attempt}): ${error instanceof Error ? error.message : String(error)}`,
          );
          return undefined;
        }
        const delay = delays[attempt - 1];
        console.warn(
          `[Persistence] ${name} failed (critical, attempt ${attempt}/${delays.length}), retrying in ${delay}ms: ${error instanceof Error ? error.message : String(error)}`,
        );
        await sleep(delay);
      }
    }
  }

  // Non-critical operations: respect breaker
  if (state && !state.available) {
    return undefined;
  }

  try {
    return await operation();
  } catch (error) {
    if (isTransientError(error)) {
      // Retry once after 500ms
      await sleep(500);
      try {
        return await operation();
      } catch (retryError) {
        if (state) state.available = false;
        console.warn(
          `[Persistence] ${name} failed (transient, retry failed, breaker tripped): ${retryError instanceof Error ? retryError.message : String(retryError)}`,
        );
        return undefined;
      }
    }

    // Non-transient error: do NOT trip breaker
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unknown';
    console.warn(
      `[Persistence] ${name} failed (non-transient, ${code}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
// Module component implementation.
