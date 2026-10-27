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

import { extractPlaywrightSpec } from './generator.ts';
import { LlmError } from '../../llm/types.ts';
import { JobCancelledError } from '../cancellation.ts';

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

  try {
    const response = await callLlm({
      messages,
      jsonMode: false,
      maxTokens: 2000,
      temperature: 0.1,
      tier: 'fast',
      task: 'correct',
      signal: options?.signal,
      validateContent: (content) => {
        if (!extractPlaywrightSpec(content)) {
          throw new LlmError('BAD_RESPONSE', 'Corrector output missing Playwright TypeScript spec');
        }
      },
    });

    const code = extractPlaywrightSpec(response.content);
    return {
      code,
      model: response.model,
      provider: response.provider,
    };
  } catch (err) {
    if (err instanceof JobCancelledError || options?.signal?.aborted) {
      throw err;
    }
    return {
      code: null,
      model: '',
      provider: '',
    };
  }
}
// Module component implementation.
