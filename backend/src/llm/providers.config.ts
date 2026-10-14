// Determines the sequence of LLM providers for the fallback chain
export const LLM_PROVIDER_ORDER = [
  'groq',   // Primary provider
  'gemini', // Fallback provider
] as const;

export type LlmProviderName = (typeof LLM_PROVIDER_ORDER)[number];

export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';


// Generous default timeout
export const LLM_REQUEST_TIMEOUT_MS = 120_000;

export const LLM_MAX_RETRIES_PER_PROVIDER = 2;