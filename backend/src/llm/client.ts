import { observeLlmCall } from './telemetry.ts';
import { config, getActiveProviders } from '../config.ts';
import { LlmError } from './types.ts';
import type { LlmRequest, LlmResponse, LlmMessage, LlmModelErrorCode, LlmProvider } from './types.ts';
import { LLM_MAX_RETRIES_PER_PROVIDER, LLM_REQUEST_TIMEOUT_MS, LLM_PROVIDER_ORDER, getModelsFor } from './providers.config.ts';
import type { LlmProviderName } from './providers.config.ts';
import { PROVIDER_REGISTRY } from './providers/index.ts';
import { hasAnyRequestKey, llmKeyOverride } from './requestKeys.ts';
import { JobCancelledError } from '../agent/cancellation.ts';
import { recordServerEvent } from '../observability/serverEvents.ts';
import { logger } from '../observability/logger.ts';

interface LlmCallLog {
  timestamp: string;
  provider: LlmProviderName;
  model: string;
  attempt: number;
  success: boolean;
  latencyMs: number;
  usage?: { promptTokens: number; completionTokens: number };
  purpose?: 'plan' | 'repair' | 'expand';
  task?: string;
  errorCode?: LlmModelErrorCode;
  errorMessage?: string;
  requestPreview: string;
  responsePreview?: string;
}

interface CollectedFailure {
  provider: LlmProviderName;
  model?: string;
  attempt: number;
  errorCode: LlmModelErrorCode;
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

function shouldRetry(code: LlmModelErrorCode): boolean {
  switch (code) {
    case 'RATE_LIMITED':
    case 'TIMEOUT':
    case 'PROVIDER_UNAVAILABLE':
      return true;
    case 'MODEL_UNAVAILABLE':
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

  const isProd = config.NODE_ENV === 'production';
  if (entry.success) {
    const p = entry.usage?.promptTokens ?? 0;
    const c = entry.usage?.completionTokens ?? 0;
    logger.info(`LLM call succeeded (${entry.provider}/${entry.model})`, {
      component: 'LLM',
      provider: entry.provider,
      model: entry.model,
      attempt: entry.attempt,
      latencyMs: entry.latencyMs,
      promptTokens: p,
      completionTokens: c,
      purpose: entry.purpose,
      task: entry.task,
      ...(isProd ? {} : { requestPreview: entry.requestPreview, responsePreview: entry.responsePreview }),
    });
  } else {
    logger.warn(`LLM call failed (${entry.provider}/${entry.model}): ${entry.errorMessage}`, {
      component: 'LLM',
      provider: entry.provider,
      model: entry.model,
      attempt: entry.attempt,
      latencyMs: entry.latencyMs,
      errorCode: entry.errorCode,
      purpose: entry.purpose,
      task: entry.task,
      ...(isProd ? {} : { requestPreview: entry.requestPreview }),
    });
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
      logger.info(`skip ${providerName}: est ${est} tok > TPM budget`, {
        component: 'LLM',
        provider: providerName,
        estTokens: est,
      });
      continue;
    }

    const provider = PROVIDER_REGISTRY[providerName];
    const tier = request.tier ?? 'reasoning';
    const models = request.modelOverride
      ? [request.modelOverride]
      : getModelsFor(providerName, tier);

    for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
      const currentModel = models[modelIdx];
      const modelRequest: LlmRequest = { ...request, modelOverride: currentModel };

      for (let attempt = 0; attempt <= LLM_MAX_RETRIES_PER_PROVIDER; attempt++) {
        if (request.signal?.aborted) {
          throw new JobCancelledError();
        }
        const timestamp = new Date().toISOString();
        try {
          const response = await attemptProviderCall(provider, modelRequest);

          await logCall({
            timestamp,
            provider: providerName,
            model: response.model || currentModel,
            attempt,
            purpose: request.purpose,
            task: request.task,
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
            model: currentModel,
            attempt,
            purpose: request.purpose,
            task: request.task,
            success: false,
            latencyMs: Date.now() - Date.parse(timestamp),
            errorCode: llmErr.code,
            errorMessage: llmErr.message,
            requestPreview,
          });

          collectedFailures.push({
            provider: providerName,
            model: currentModel,
            attempt,
            errorCode: llmErr.code,
            errorMessage: llmErr.message,
          });

          // P7.5: MODEL_UNAVAILABLE error classification for model-advance only.
          if ((llmErr.code as string) === 'MODEL_UNAVAILABLE') {
            logger.warn(`Model ${providerName}:${currentModel} unavailable, advancing to fallback model in chain`, {
              component: 'LLM',
              provider: providerName,
              model: currentModel,
              nextModel: models[modelIdx + 1] ?? 'none',
            });
            break; // Stop retrying currentModel, advance to next model in models loop
          }

          if (llmErr.code === 'AUTH_FAILED') {
            modelIdx = models.length; // Key invalid; skip remaining models, next provider
            break;
          }

          // BAD_RESPONSE and every other non-retryable error -> next PROVIDER immediately
          if (!shouldRetry(llmErr.code)) {
            modelIdx = models.length;
            break;
          }

          // P10 / Part 7b: Measured Groq TPM-reservation behavior shows long retry windows (>10s)
          // are better handled by immediate failover to the next provider than burning retries or testing secondary models.
          if (llmErr.code === 'RATE_LIMITED' && (llmErr.retryAfterMs ?? 0) > 10_000) {
            modelIdx = models.length;
            break;
          }

          // Exhausted retries on this model -> next PROVIDER immediately
          if (attempt === LLM_MAX_RETRIES_PER_PROVIDER) {
            modelIdx = models.length;
            break;
          }

          const backoffMs = calculateBackoff(attempt, llmErr.retryAfterMs);
          await sleep(backoffMs, request.signal);
        }
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
