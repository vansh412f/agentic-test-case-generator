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

const FENCE_REGEX = /```(?:typescript|ts|tsx|javascript|js)?[ \t]*\r?\n([\s\S]*?)\r?\n```/;

export function extractPlaywrightSpec(raw: string): string | null {
  const match = FENCE_REGEX.exec(raw);
  if (match?.[1] && match[1].trim().length > 0) {
    return match[1].trim();
  }

  // Fallback for unfenced model completions
  let trimmed = raw.trim();
  // Strip leading/trailing ``` lines if present
  trimmed = trimmed.replace(/^```(?:typescript|ts|tsx|javascript|js)?\s*/i, '');
  trimmed = trimmed.replace(/\s*```$/, '');
  trimmed = trimmed.trim();

  if (trimmed.startsWith('import {') && trimmed.includes('@playwright/test')) {
    return trimmed;
  }

  return null;
}

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
    validateContent: (content) => {
      if (!extractPlaywrightSpec(content)) {
        throw new LlmError('BAD_RESPONSE', 'Generator output missing Playwright TypeScript spec');
      }
    },
  });

  const code = extractPlaywrightSpec(response.content)!;
  const filename = `${testCase.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.spec.ts`;

  return {
    filename,
    code,
    testCaseId: testCase.id,
  };
}
// Module component implementation.
