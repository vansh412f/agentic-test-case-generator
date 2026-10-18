import { LlmError } from '../types.ts';
import type { LlmRequest, LlmResponse } from '../types.ts';
import type { LlmProviderName } from '../providers.config.ts';

interface OpenAiResponseEnvelope {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export const unsupportedReasoningEffort = new Set<string>();

export async function openAiCompatibleChat(options: {
  providerName: LlmProviderName;
  endpointUrl: string;
  apiKey: string;
  defaultModel: string;
  model?: string;
  reasoningEffort?: string;
  request: LlmRequest;
  signal: AbortSignal;
}): Promise<LlmResponse> {
  const { providerName, endpointUrl, apiKey, request, signal } = options;
  const effectiveModel = options.model || options.defaultModel;
  const unsupportedKey = `${providerName}:${effectiveModel}`;

  const buildBodyPayload = (includeReasoning: boolean): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      model: effectiveModel,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 4096,
    };

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }

    if (request.jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    if (
      includeReasoning &&
      options.reasoningEffort !== undefined &&
      !unsupportedReasoningEffort.has(unsupportedKey)
    ) {
      payload.reasoning_effort = options.reasoningEffort;
    }

    return payload;
  };

  let bodyPayload = buildBodyPayload(true);

  let response: Response;
  try {
    response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LlmError('TIMEOUT', `Provider ${providerName} request timed out.`, err);
    }
    if (err instanceof LlmError) throw err;
    throw new LlmError('PROVIDER_UNAVAILABLE', `Failed to reach ${providerName} API.`, err);
  }

  // If the provider returns 400: check for invalid API key first, then retry if body mentions reasoning_effort
  if (response.status === 400) {
    const errorText = await response.text().catch(() => 'No response body');
    if (errorText.includes('API key not valid')) {
      throw new LlmError('AUTH_FAILED', `${providerName} auth failed (400): ${errorText}`);
    }
    if (bodyPayload.reasoning_effort !== undefined && errorText.includes('reasoning_effort')) {
      unsupportedReasoningEffort.add(unsupportedKey);
      bodyPayload = buildBodyPayload(false);
      try {
        response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
          signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new LlmError('TIMEOUT', `Provider ${providerName} request timed out on retry.`, err);
        }
        if (err instanceof LlmError) throw err;
        throw new LlmError('PROVIDER_UNAVAILABLE', `Failed to reach ${providerName} API on retry.`, err);
      }
    } else {
      throw new LlmError('BAD_RESPONSE', `${providerName} returned 400: ${errorText}`);
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'No response body');

    if (
      response.status === 401 ||
      response.status === 403 ||
      (response.status === 400 && errorText.includes('API key not valid'))
    ) {
      throw new LlmError('AUTH_FAILED', `${providerName} auth failed (${response.status}): ${errorText}`);
    }
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
      const retryAfterMs = (retryAfterSeconds && !isNaN(retryAfterSeconds)) ? retryAfterSeconds * 1000 : undefined;
      throw new LlmError('RATE_LIMITED', `Provider ${providerName} rate limited: ${errorText}`, undefined, retryAfterMs);
    }
    if (response.status === 408 || response.status === 504) {
      throw new LlmError('TIMEOUT', `${providerName} timeout (${response.status}): ${errorText}`);
    }
    if (response.status >= 500) {
      throw new LlmError('PROVIDER_UNAVAILABLE', `${providerName} server error (${response.status}): ${errorText}`);
    }

    throw new LlmError('BAD_RESPONSE', `${providerName} returned ${response.status}: ${errorText}`);
  }

  let data: OpenAiResponseEnvelope;
  try {
    data = (await response.json()) as OpenAiResponseEnvelope;
  } catch (err) {
    throw new LlmError('BAD_RESPONSE', `${providerName} returned invalid JSON.`, err);
  }

  if (!data.choices?.[0]?.message?.content) {
    throw new LlmError('BAD_RESPONSE', `${providerName} response missing choices[0].message.content`, data);
  }

  return {
    content: data.choices[0].message.content,
    model: data.model || effectiveModel,
    provider: providerName,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}
