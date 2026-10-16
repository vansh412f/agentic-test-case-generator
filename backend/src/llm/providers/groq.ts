import { config } from '../../config.ts';
import { LlmError } from '../types.ts';
import type { LlmProvider, LlmRequest, LlmResponse } from '../types.ts';
import { GROQ_DEFAULT_MODEL } from '../providers.config.ts';
import { openAiCompatibleChat } from './openAiCompatible.ts';

import { llmKeyOverride } from '../requestKeys.ts';

export const groqProvider: LlmProvider = {
  name: 'groq',
  async chat(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    const apiKey = llmKeyOverride('groq') ?? config.GROQ_API_KEY;
    if (!apiKey) {
      throw new LlmError('AUTH_FAILED', 'Groq API key is missing from configuration (server or request).');
    }
    return openAiCompatibleChat({
      providerName: 'groq',
      endpointUrl: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey,
      defaultModel: GROQ_DEFAULT_MODEL,
      request,
      signal,
    });
  },
};
