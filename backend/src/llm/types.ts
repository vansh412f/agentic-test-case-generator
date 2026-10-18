import type { LlmProviderName } from './providers.config.ts';

// Error codes
export const LLM_ERROR_CODES = [
  'RATE_LIMITED',
  'AUTH_FAILED',
  'TIMEOUT',
  'BAD_RESPONSE',
  'PROVIDER_UNAVAILABLE',
  'ALL_PROVIDERS_FAILED',
] as const;

export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

// Message primitives
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Request / Response shapes

/** Everything the caller provides per LLM call. */
export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  /** Hard cap on generated tokens. Providers apply their own default when omitted. */
  maxTokens?: number;
  /**
   * When true, the client passes `response_format: { type: "json_object" }`
   * to the provider API. The caller's prompt must explicitly mention JSON.
   */
  jsonMode?: boolean;
  /** Latency/reasoning tier. Default is 'reasoning'. */
  tier?: 'reasoning' | 'fast';
}

/** Normalised response returned to the caller regardless of provider. */
export interface LlmResponse {
  content: string;
  model: string;
  provider: LlmProviderName;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  latencyMs?: number;
}

// Provider contract

/**
 * Every provider wrapper must implement this interface.
 * The `signal` parameter comes from the client's `AbortController` and must
 * be forwarded to `fetch` so that per-provider timeouts are enforced correctly.
 */
export interface LlmProvider {
  readonly name: LlmProviderName;
  chat(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse>;
}
