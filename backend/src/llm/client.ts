import fs from 'node:fs/promises';
import { observeLlmCall } from './telemetry.ts';
import path from 'node:path';
import { config, activeProviders } from '../config.ts';
import { LlmError } from './types.ts';
import type { LlmRequest, LlmResponse, LlmMessage, LlmErrorCode, LlmProvider } from './types.ts';
import { LLM_MAX_RETRIES_PER_PROVIDER, LLM_REQUEST_TIMEOUT_MS, LLM_PROVIDER_ORDER } from './providers.config.ts';
import type { LlmProviderName } from './providers.config.ts';
import { PROVIDER_REGISTRY } from './providers/index.ts';
import { llmKeyOverride } from './requestKeys.ts';

interface LlmCallLog {
  timestamp: string;
  provider: LlmProviderName;
  model: string;
  attempt: number;
  success: boolean;
  latencyMs: number;
  usage?: { promptTokens: number; completionTokens: number };
  errorCode?: LlmErrorCode;
  errorMessage?: string;
  requestPreview: string;
  responsePreview?: string;
}

interface CollectedFailure {
  provider: LlmProviderName;
  attempt: number;
  errorCode: LlmErrorCode;
  errorMessage: string;
}

async function attemptProviderCall(provider: LlmProvider, request: LlmRequest): Promise<LlmResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await provider.chat(request, controller.signal);
    response.latencyMs = Date.now() - startedAt;
    return response;
  } catch (err) {
    if (err instanceof LlmError) {
      throw err;
    }
    throw new LlmError('PROVIDER_UNAVAILABLE', 'Unexpected provider error', err);
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldRetry(code: LlmErrorCode): boolean {
  switch (code) {
    case 'RATE_LIMITED':
    case 'TIMEOUT':
    case 'PROVIDER_UNAVAILABLE':
      return true;
    case 'AUTH_FAILED':
    case 'BAD_RESPONSE':
    case 'ALL_PROVIDERS_FAILED':
      return false;
    default: {
      code satisfies never;
      return false;
    }
  }
}

function calculateBackoff(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, 30_000);
  }
  return Math.min(1000 * Math.pow(2, attempt), 30_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRequestPreview(messages: LlmMessage[]): string {
  const fullPreview = messages.map(m => `[${m.role}] ${m.content}`).join(' | ');
  if (fullPreview.length > 200) {
    return fullPreview.slice(0, 200) + '...';
  }
  return fullPreview;
}

async function logCall(entry: LlmCallLog): Promise<void> {
  await observeLlmCall(entry);
  if (config.NODE_ENV === 'production') {
    return;
  }

  if (entry.success) {
    const p = entry.usage?.promptTokens ?? 0;
    const c = entry.usage?.completionTokens ?? 0;
    console.log(`[LLM] ${entry.provider} | ${entry.model} | ${entry.latencyMs}ms | prompt=${p} completion=${c} | ok`);
  } else {
    console.log(`[LLM] ${entry.provider} | FAIL (${entry.errorCode}) | ${entry.errorMessage}`);
  }

  const logsDir = path.resolve(process.cwd(), 'logs');
  const safeTimestamp = entry.timestamp.replace(/[:.]/g, '-');
  const statusStr = entry.success ? 'ok' : 'fail';
  const filename = `${safeTimestamp}-${entry.provider}-${statusStr}.json`;
  const filePath = path.join(logsDir, filename);

  try {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[LLM] Failed to write log file to ${filePath}:`, err);
  }
}

export async function callLlm(request: LlmRequest): Promise<LlmResponse> {
  const collectedFailures: CollectedFailure[] = [];
  const requestPreview = buildRequestPreview(request.messages);

  const effectiveProviders = LLM_PROVIDER_ORDER.filter(
    (name) => llmKeyOverride(name) !== undefined || activeProviders.includes(name),
  );

  if (effectiveProviders.length === 0) {
    throw new LlmError('AUTH_FAILED', 'No LLM provider keys are configured (server or request).');
  }

  for (const providerName of effectiveProviders) {
    const provider = PROVIDER_REGISTRY[providerName];

    for (let attempt = 0; attempt <= LLM_MAX_RETRIES_PER_PROVIDER; attempt++) {
      const timestamp = new Date().toISOString();
      try {
        const response = await attemptProviderCall(provider, request);

        await logCall({
          timestamp,
          provider: providerName,
          model: response.model,
          attempt,
          success: true,
          latencyMs: response.latencyMs ?? 0,
          usage: response.usage,
          requestPreview,
          responsePreview: response.content.slice(0, 200),
        });

        return response;
      } catch (err) {
        const llmErr = err instanceof LlmError
          ? err
          : new LlmError('PROVIDER_UNAVAILABLE', 'Unexpected provider error', err);

        await logCall({
          timestamp,
          provider: providerName,
          model: 'unknown',
          attempt,
          success: false,
          latencyMs: Date.now() - Date.parse(timestamp),
          errorCode: llmErr.code,
          errorMessage: llmErr.message,
          requestPreview,
        });

        collectedFailures.push({
          provider: providerName,
          attempt,
          errorCode: llmErr.code,
          errorMessage: llmErr.message,
        });

        // Do not retry non-retryable errors on this provider
        if (!shouldRetry(llmErr.code)) {
          break; // move to next provider
        }

        // P10 / Part 7b: Measured Groq TPM-reservation behavior shows long retry windows (>10s)
        // are better handled by immediate failover to the next provider than burning retries.
        if (llmErr.code === 'RATE_LIMITED' && (llmErr.retryAfterMs ?? 0) > 10_000) {
          break;
        }

        // Exhausted retries on this provider
        if (attempt === LLM_MAX_RETRIES_PER_PROVIDER) {
          break;
        }

        const backoffMs = calculateBackoff(attempt, llmErr.retryAfterMs);
        await sleep(backoffMs);
      }
    }
  }

  throw new LlmError(
    'ALL_PROVIDERS_FAILED',
    `All ${effectiveProviders.length} provider(s) exhausted. Failures: ${JSON.stringify(collectedFailures)}`,
    collectedFailures,
  );
}
