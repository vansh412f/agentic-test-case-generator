import dotenv from 'dotenv';
dotenv.config();

export const KNOWN_LLM_PROVIDERS = ['groq', 'gemini'] as const;
export type LlmProviderName = (typeof KNOWN_LLM_PROVIDERS)[number];

export function parseProviderOrder(raw?: string): LlmProviderName[] {
  const input = raw?.trim() || 'groq,gemini';
  const parts = input.split(',').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (!KNOWN_LLM_PROVIDERS.includes(part as LlmProviderName)) {
      throw new Error(`Invalid LLM provider in LLM_PROVIDER_ORDER: "${part}". Allowed: ${KNOWN_LLM_PROVIDERS.join(', ')}`);
    }
  }
  return parts as LlmProviderName[];
}

export const LLM_PROVIDER_ORDER: LlmProviderName[] = parseProviderOrder(process.env.LLM_PROVIDER_ORDER);

export const GROQ_DEFAULT_REASONING_CHAIN = ['openai/gpt-oss-120b'];
export const GROQ_DEFAULT_FAST_CHAIN = ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
export const GEMINI_DEFAULT_REASONING_CHAIN = ['gemini-3.5-flash', 'gemini-2.5-flash'];
export const GEMINI_DEFAULT_FAST_CHAIN = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

export const GROQ_DEFAULT_MODEL = GROQ_DEFAULT_REASONING_CHAIN[0];
export const GEMINI_DEFAULT_MODEL = GEMINI_DEFAULT_REASONING_CHAIN[0];

export function parseModelChain(
  pluralVal?: string,
  singularVal?: string,
  defaultChain: string[] = [],
): string[] {
  if (pluralVal && pluralVal.trim()) {
    const list = pluralVal
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length > 0) {
      return Array.from(new Set(list)).slice(0, 3); // de-duplicate preserving order, cap 3
    }
  }
  if (singularVal && singularVal.trim()) {
    const combined = [singularVal.trim(), ...defaultChain].filter(Boolean);
    return Array.from(new Set(combined)).slice(0, 3); // reprioritize singular to primary, de-duplicate, cap 3
  }
  return Array.from(new Set(defaultChain)).slice(0, 3);
}

export function getModelsFor(
  provider: LlmProviderName,
  tier: 'reasoning' | 'fast' = 'reasoning',
): string[] {
  if (provider === 'groq') {
    return tier === 'fast'
      ? parseModelChain(
          process.env.GROQ_FAST_MODELS,
          process.env.GROQ_FAST_MODEL,
          GROQ_DEFAULT_FAST_CHAIN,
        )
      : parseModelChain(
          process.env.GROQ_REASONING_MODELS,
          process.env.GROQ_REASONING_MODEL,
          GROQ_DEFAULT_REASONING_CHAIN,
        );
  }
  if (provider === 'gemini') {
    return tier === 'fast'
      ? parseModelChain(
          process.env.GEMINI_FAST_MODELS,
          process.env.GEMINI_FAST_MODEL,
          GEMINI_DEFAULT_FAST_CHAIN,
        )
      : parseModelChain(
          process.env.GEMINI_REASONING_MODELS,
          process.env.GEMINI_REASONING_MODEL,
          GEMINI_DEFAULT_REASONING_CHAIN,
        );
  }
  return [];
}

export function modelFor(
  provider: LlmProviderName,
  tier: 'reasoning' | 'fast' = 'reasoning',
): string {
  const models = getModelsFor(provider, tier);
  return models[0] ?? '';
}

export function reasoningEffortFor(
  provider: LlmProviderName,
  tier: 'reasoning' | 'fast' = 'reasoning',
  _model?: string,
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
// Module component implementation.

