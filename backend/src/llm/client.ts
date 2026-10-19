import fs from 'node:fs/promises';
import { observeLlmCall } from './telemetry.ts';
import path from 'node:path';
import { config, getActiveProviders } from '../config.ts';
import { LlmError } from './types.ts';
import type { LlmRequest, LlmResponse, LlmMessage, LlmErrorCode, LlmProvider } from './types.ts';
import { LLM_MAX_RETRIES_PER_PROVIDER, LLM_REQUEST_TIMEOUT_MS, LLM_PROVIDER_ORDER } from './providers.config.ts';
import type { LlmProviderName } from './providers.config.ts';
import { PROVIDER_REGISTRY } from './providers/index.ts';
import { hasAnyRequestKey, llmKeyOverride } from './requestKeys.ts';
import { JobCancelledError } from '../agent/cancellation.ts';
import { recordServerEvent } from '../observability/serverEvents.ts';

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
  if (request.signal?.aborted) {
    throw new JobCancelledError();
  }
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), LLM_REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  const signals: AbortSignal[] = [timeoutController.signal];
  if (request.signal) signals.push(request.signal);
  const combinedSignal = AbortSignal.any(signals);

  try {
    const response = await provider.chat(request, combinedSignal);
    response.latencyMs = Date.now() - startedAt;
    return response;
  } catch (err) {
    if (request.signal?.aborted) {
      throw new JobCancelledError();
    }
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new JobCancelledError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new JobCancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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

  const byok = hasAnyRequestKey();
  const effectiveProviders = LLM_PROVIDER_ORDER.filter((name) =>
    byok ? llmKeyOverride(name) !== undefined : getActiveProviders().includes(name),
  );

  if (effectiveProviders.length === 0) {
    throw new LlmError(
      'AUTH_FAILED',
      byok ? 'No usable key in request.' : 'No LLM provider keys are configured (server or request).',
    );
  }

  const totalMessageChars = request.messages.reduce((sum, m) => sum + m.content.length, 0);
  const est = Math.ceil(totalMessageChars / 3.5) + (request.maxTokens ?? 4096);
  const PROVIDER_TPM_BUDGET: Partial<Record<LlmProviderName, number>> = { groq: 7500 };

  for (let i = 0; i < effectiveProviders.length; i++) {
    const providerName = effectiveProviders[i];
    const remainingProviders = effectiveProviders.slice(i + 1);
    const budget = PROVIDER_TPM_BUDGET[providerName];

    if (budget !== undefined && est > budget && remainingProviders.length > 0) {
      console.log(`[LLM] skip ${providerName}: est ${est} tok > TPM budget`);
      continue;
    }

    const provider = PROVIDER_REGISTRY[providerName];

    for (let attempt = 0; attempt <= LLM_MAX_RETRIES_PER_PROVIDER; attempt++) {
      if (request.signal?.aborted) {
        throw new JobCancelledError();
      }
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
        if (request.signal?.aborted || err instanceof JobCancelledError) {
          throw new JobCancelledError();
        }

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
        await sleep(backoffMs, request.signal);
      }
    }
  }

  const allFailedMsg = `All ${effectiveProviders.length} provider(s) exhausted. Failures: ${JSON.stringify(collectedFailures)}`;
  recordServerEvent('error', 'llm:all_providers_failed', allFailedMsg);

  throw new LlmError(
    'ALL_PROVIDERS_FAILED',
    allFailedMsg,
    collectedFailures,
  );
}
// Module component implementation.
