import type { z } from 'zod';
import { callLlm } from '../../llm/client.ts';
import { LlmError } from '../../llm/types.ts';
import type { LlmMessage } from '../../llm/types.ts';
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserPrompt, TestPlanSchema } from '../prompts/plannerPrompt.ts';
import type { TestPlan } from '../prompts/plannerPrompt.ts';
import type { AppMap } from '../../crawler/types.ts';

function formatZodErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
}

export async function planTests(appMap: AppMap): Promise<TestPlan> {
  const appMapJson = JSON.stringify(appMap);
  const messages: LlmMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
    { role: 'user', content: buildPlannerUserPrompt(appMapJson) },
  ];

  const response = await callLlm({
    messages,
    jsonMode: true,
    maxTokens: 4000,
  });

  let parsed: unknown;
  let errorDetails = '';

  try {
    parsed = JSON.parse(response.content);
    const result = TestPlanSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    errorDetails = `Validation failed:\n${formatZodErrors(result.error)}`;
  } catch (parseError) {
    const msg = parseError instanceof Error ? parseError.message : String(parseError);
    errorDetails = `Invalid JSON syntax: ${msg}`;
  }

  // Self-repair (exactly one attempt)
  const repairMessages: LlmMessage[] = [
    ...messages,
    { role: 'assistant', content: response.content },
    {
      role: 'user',
      content: `Your previous response failed validation.\n\nErrors:\n${errorDetails}\n\nReturn ONLY the corrected JSON object. No prose, no markdown, no code fences.`,
    },
  ];

  const repairResponse = await callLlm({
    messages: repairMessages,
    jsonMode: true,
    maxTokens: 4000,
  });

  try {
    const repairedParsed = JSON.parse(repairResponse.content);
    const repairResult = TestPlanSchema.safeParse(repairedParsed);
    if (repairResult.success) {
      return repairResult.data;
    }
    const repairError = formatZodErrors(repairResult.error);
    throw new LlmError('BAD_RESPONSE', 'Planner failed after self-repair attempt', { originalError: errorDetails, repairError });
  } catch (repairParseError) {
    if (repairParseError instanceof LlmError) {
      throw repairParseError;
    }
    const msg = repairParseError instanceof Error ? repairParseError.message : String(repairParseError);
    throw new LlmError('BAD_RESPONSE', 'Planner failed after self-repair attempt', { originalError: errorDetails, repairError: msg });
  }
}
