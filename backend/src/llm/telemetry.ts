import { AsyncLocalStorage } from 'node:async_hooks';
import type { LlmProviderName } from './providers.config.ts';

export interface LlmCallEvent {
  timestamp: string;
  provider: LlmProviderName;
  model: string;
  success: boolean;
  latencyMs: number;
  usage?: { promptTokens: number; completionTokens: number };
  errorCode?: string;
  errorMessage?: string;
}

type Observer = (event: LlmCallEvent) => Promise<void>;
const observers = new AsyncLocalStorage<Observer>();

export function withLlmObserver<T>(observer: Observer, operation: () => Promise<T>): Promise<T> {
  return observers.run(observer, operation);
}

export async function observeLlmCall(event: LlmCallEvent): Promise<void> {
  try {
    await observers.getStore()?.(event);
  } catch (error) {
    console.warn('[Persistence] LLM observer failed:', error instanceof Error ? error.message : String(error));
  }
}
