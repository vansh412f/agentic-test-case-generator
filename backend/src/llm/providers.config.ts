import dotenv from 'dotenv';
dotenv.config();

export const KNOWN_LLM_PROVIDERS = ['groq', 'gemini', 'nvidia'] as const;
export type LlmProviderName = (typeof KNOWN_LLM_PROVIDERS)[number];

export function parseProviderOrder(raw?: string): LlmProviderName[] {
  const input = raw?.trim() || 'groq,gemini,nvidia';
  const parts = input.split(',').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (!KNOWN_LLM_PROVIDERS.includes(part as LlmProviderName)) {
      throw new Error(`Invalid LLM provider in LLM_PROVIDER_ORDER: "${part}". Allowed: ${KNOWN_LLM_PROVIDERS.join(', ')}`);
    }
  }
  return parts as LlmProviderName[];
}

export const LLM_PROVIDER_ORDER: LlmProviderName[] = parseProviderOrder(process.env.LLM_PROVIDER_ORDER);

export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
export const NVIDIA_DEFAULT_MODEL = 'openai/gpt-oss-20b';

export function modelFor(provider: LlmProviderName, tier: 'reasoning' | 'fast' = 'reasoning'): string {
  if (provider === 'groq') {
    return tier === 'fast'
      ? (process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b')
      : (process.env.GROQ_REASONING_MODEL || GROQ_DEFAULT_MODEL);
  }
  if (provider === 'gemini') {
    return tier === 'fast'
      ? (process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash-lite')
      : (process.env.GEMINI_REASONING_MODEL || GEMINI_DEFAULT_MODEL);
  }
  if (provider === 'nvidia') {
    return process.env.NVIDIA_MODEL || NVIDIA_DEFAULT_MODEL;
  }
  return '';
}

export function reasoningEffortFor(
  provider: LlmProviderName,
  tier: 'reasoning' | 'fast' = 'reasoning',
): string | undefined {
  if (provider === 'groq') {
    return 'low';
  }
  if (provider === 'gemini') {
    return tier === 'reasoning' ? 'low' : undefined;
  }
  return undefined;
}

// Generous default timeout
export const LLM_REQUEST_TIMEOUT_MS = 120_000;

export const LLM_MAX_RETRIES_PER_PROVIDER = 2;