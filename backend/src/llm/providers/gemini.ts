import { config } from '../../config.ts';
import { LlmError } from '../types.ts';
import type { LlmProvider, LlmRequest, LlmResponse } from '../types.ts';
import { GEMINI_DEFAULT_MODEL } from '../providers.config.ts';
import { openAiCompatibleChat } from './openAiCompatible.ts';

import { hasAnyRequestKey, llmKeyOverride } from '../requestKeys.ts';

export const geminiProvider: LlmProvider = {
  name: 'gemini',
  async chat(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    const apiKey = hasAnyRequestKey() ? llmKeyOverride('gemini') : config.GEMINI_API_KEY;
    if (!apiKey) {
      throw new LlmError('AUTH_FAILED', 'Gemini API key is missing from configuration (server or request).');
    }
    return openAiCompatibleChat({
      providerName: 'gemini',
      endpointUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey,
      defaultModel: GEMINI_DEFAULT_MODEL,
      request,
      signal,
    });
  },
};
