import type { LlmProvider } from '../types.ts';
import type { LlmProviderName } from '../providers.config.ts';
import { groqProvider } from './groq.ts';
import { geminiProvider } from './gemini.ts';
import { nvidiaProvider } from './nvidia.ts';

export const PROVIDER_REGISTRY: Record<LlmProviderName, LlmProvider> = {
  groq: groqProvider,
  gemini: geminiProvider,
  nvidia: nvidiaProvider,
};
