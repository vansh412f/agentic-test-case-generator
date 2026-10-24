import { callLlm } from '../../llm/client.ts';
import type { LlmMessage } from '../../llm/types.ts';
import {
  CORRECTOR_SYSTEM_PROMPT,
  buildCorrectorUserPrompt,
} from '../prompts/correctorPrompt.ts';
import type { ScopedElement } from '../types.ts';

export interface CorrectionResult {
  code: string | null; // null if correction failed
  model: string;
  provider: string;
}

const FENCE_REGEX = /```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/;

export { correctionPreservesAssertions, correctionPreservesSecrets } from '../assertionGuard.ts';

export async function correctTest(
  failingCode: string,
  error: string,
  elementsInScope: ScopedElement[],
  previousErrors: string[] = [],
  options?: {
    signal?: AbortSignal;
    failureContext?: { finalUrl?: string; navigations?: string[] } | null;
    observationsText?: string;
  },
): Promise<CorrectionResult> {
  const messages: LlmMessage[] = [
    { role: 'system', content: CORRECTOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildCorrectorUserPrompt({
        code: failingCode,
        error,
        elementsInScope,
        previousErrors,
        failureContext: options?.failureContext,
        observationsText: options?.observationsText,
      }),
    },
  ];

  const response = await callLlm({
    messages,
    jsonMode: false,
    maxTokens: 2000,
    temperature: 0.1,
    tier: 'fast',
    task: 'correct',
    signal: options?.signal,
  });

  const match = FENCE_REGEX.exec(response.content);
  if (!match?.[1]) {
    return {
      code: null,
      model: response.model,
      provider: response.provider,
    };
  }

  return {
    code: match[1].trim(),
    model: response.model,
    provider: response.provider,
  };
}
// Module component implementation.
