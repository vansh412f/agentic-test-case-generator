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

export async function openAiCompatibleChat(options: {
  providerName: LlmProviderName;
  endpointUrl: string;
  apiKey: string;
  defaultModel: string;
  request: LlmRequest;
  signal: AbortSignal;
}): Promise<LlmResponse> {
  const { providerName, endpointUrl, apiKey, defaultModel, request, signal } = options;

  const bodyPayload: Record<string, unknown> = {
    model: defaultModel,
    messages: request.messages,
    max_tokens: request.maxTokens ?? 4096,
  };

  if (request.temperature !== undefined) {
    bodyPayload.temperature = request.temperature;
  }

  if (request.jsonMode) {
    bodyPayload.response_format = { type: 'json_object' };
  }

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

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'No response body');

    if (response.status === 401 || response.status === 403) {
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
    model: data.model || defaultModel,
    provider: providerName,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}
