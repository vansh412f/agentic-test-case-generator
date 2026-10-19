import { AsyncLocalStorage } from 'node:async_hooks';
import type { LlmProviderName } from './providers.config.ts';

export interface RequestLlmKeys {
  groq?: string;
  gemini?: string;
  nvidia?: never;
}

const storage = new AsyncLocalStorage<RequestLlmKeys>();

export function withRequestLlmKeys<T>(keys: RequestLlmKeys, fn: () => Promise<T>): Promise<T> {
  return storage.run(keys, fn);
}

export function getRequestLlmKeys(): RequestLlmKeys | undefined {
  return storage.getStore();
}

export function llmKeyOverride(provider: LlmProviderName): string | undefined {
  if (provider === 'nvidia') return undefined;
  const value = storage.getStore()?.[provider];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function hasAnyRequestKey(): boolean {
  const store = storage.getStore();
  return Boolean(store?.groq?.trim() || store?.gemini?.trim());
}

export function hasOwnKeys(req: { header(name: string): string | undefined }): boolean {
  return Boolean(req.header('x-groq-api-key')?.trim() || req.header('x-gemini-api-key')?.trim());
}
