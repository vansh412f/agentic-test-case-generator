import { config } from '../../config.ts';
import { LlmError } from '../types.ts';
import type { LlmProvider, LlmRequest, LlmResponse } from '../types.ts';
import { GROQ_DEFAULT_MODEL } from '../providers.config.ts';
import { openAiCompatibleChat } from './openAiCompatible.ts';

export const groqProvider: LlmProvider = {
  name: 'groq',
  async chat(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    if (!config.GROQ_API_KEY) {
      throw new LlmError('AUTH_FAILED', 'Groq API key is missing from configuration.');
    }
    return openAiCompatibleChat({
      providerName: 'groq',
      endpointUrl: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: config.GROQ_API_KEY,
      defaultModel: GROQ_DEFAULT_MODEL,
      request,
      signal,
    });
  },
};
