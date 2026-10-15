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

export function correctionPreservesAssertions(before: string, after: string): boolean {
  const beforeExpectCount = (before.match(/expect\(/g) ?? []).length;
  const afterExpectCount = (after.match(/expect\(/g) ?? []).length;
  if (beforeExpectCount !== afterExpectCount) {
    return false;
  }

  const beforeExpectLines = before.split(/\r?\n/).filter((l) => l.includes('expect('));
  const afterExpectLines = after.split(/\r?\n/).filter((l) => l.includes('expect('));

  const STRING_LITERAL_REGEX = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

  for (const line of beforeExpectLines) {
    let match: RegExpExecArray | null;
    while ((match = STRING_LITERAL_REGEX.exec(line)) !== null) {
      const raw = match[0];
      const content = match[1] ?? match[2] ?? match[3] ?? '';

      const found = afterExpectLines.some(
        (afterLine) =>
          afterLine.includes(raw) ||
          afterLine.includes(`'${content}'`) ||
          afterLine.includes(`"${content}"`) ||
          afterLine.includes(`\`${content}\``),
      );

      if (!found) {
        return false;
      }
    }
  }

  return true;
}

export async function correctTest(
  failingCode: string,
  error: string,
  elementsInScope: ScopedElement[],
): Promise<CorrectionResult> {
  const messages: LlmMessage[] = [
    { role: 'system', content: CORRECTOR_SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildCorrectorUserPrompt({
        code: failingCode,
        error,
        elementsInScope,
      }),
    },
  ];

  const response = await callLlm({
    messages,
    jsonMode: false,
    maxTokens: 4000,
    temperature: 0.1,
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
