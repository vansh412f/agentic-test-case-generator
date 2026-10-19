import { config } from '../../config.ts';
import { LlmError } from '../types.ts';
import type { LlmProvider, LlmRequest, LlmResponse } from '../types.ts';
import { modelFor, reasoningEffortFor } from '../providers.config.ts';
import { openAiCompatibleChat } from './openAiCompatible.ts';

export const nvidiaProvider: LlmProvider = {
  name: 'nvidia',
  async chat(request: LlmRequest, signal: AbortSignal): Promise<LlmResponse> {
    const apiKey = config.NVIDIA_API_KEY;
    if (!apiKey) {
      throw new LlmError('AUTH_FAILED', 'NVIDIA API key is missing from configuration.');
    }
    const tier = request.tier ?? 'reasoning';
    const model = modelFor('nvidia', tier);
    const reasoningEffort = reasoningEffortFor('nvidia', tier);
    return openAiCompatibleChat({
      providerName: 'nvidia',
      endpointUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
      apiKey,
      defaultModel: model,
      model,
      reasoningEffort,
      request,
      signal,
    });
  },
};
// Module component implementation.
