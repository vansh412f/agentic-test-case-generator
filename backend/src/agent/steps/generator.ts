import { callLlm } from '../../llm/client.ts';
import { LlmError } from '../../llm/types.ts';
import type { LlmMessage } from '../../llm/types.ts';
import { GENERATOR_SYSTEM_PROMPT, buildGeneratorUserPrompt } from '../prompts/generatorPrompt.ts';
import type { TestCase } from '../prompts/plannerPrompt.ts';
import type { ScopedElement } from '../types.ts';

export interface GeneratedTest {
  filename: string;
  code: string;
  testCaseId: string;
}

const FENCE_REGEX = /```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/;

export async function generateTest(
  testCase: TestCase,
  elementsInScope: ScopedElement[],
  targetUrl: string,
  options?: { signal?: AbortSignal },
): Promise<GeneratedTest> {
  const messages: LlmMessage[] = [
    { role: 'system', content: GENERATOR_SYSTEM_PROMPT },
    { role: 'user', content: buildGeneratorUserPrompt({ testCase, elementsInScope, targetUrl }) },
  ];

  const response = await callLlm({
    messages,
    maxTokens: 2000,
    tier: 'fast',
    task: 'generate',
    signal: options?.signal,
  });

  const match = FENCE_REGEX.exec(response.content);
  if (!match?.[1]) {
    throw new LlmError(
      'BAD_RESPONSE',
      'Generator output missing TypeScript code fence',
      response.content.slice(0, 500),
    );
  }

  const code = match[1].trim();
  const filename = `${testCase.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.spec.ts`;

  return {
    filename,
    code,
    testCaseId: testCase.id,
  };
}
// Module component implementation.
