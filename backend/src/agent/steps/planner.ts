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

type ValidationResult =
  | { ok: true; plan: TestPlan }
  | { ok: false; kind: 'syntax' | 'schema' | 'references'; detail: string };

function validatePlanResponse(
  content: string,
  knownIds: Set<string>,
): ValidationResult {
  // 1. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: 'syntax', detail: `Invalid JSON syntax: ${msg}` };
  }

  // 2. Zod validation (includes superRefine checks)
  const result = TestPlanSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, kind: 'schema', detail: formatZodErrors(result.error) };
  }

  // 3. Reference validation — every non-null elementId must exist in the App Map
  const invalidRefs: Array<{ testCaseId: string; badIds: string[] }> = [];
  for (const tc of result.data.testCases) {
    const badIds = tc.steps
      .map((s) => s.elementId)
      .filter((id): id is string => id !== null && !knownIds.has(id));
    if (badIds.length > 0) {
      invalidRefs.push({ testCaseId: tc.id, badIds: [...new Set(badIds)] });
    }
  }

  if (invalidRefs.length > 0) {
    const detail = invalidRefs
      .map((r) => `Test case ${r.testCaseId} references unknown elements: ${r.badIds.join(', ')}`)
      .join('\n');
    return { ok: false, kind: 'references', detail };
  }

  return { ok: true, plan: result.data };
}

export async function planTests(appMap: AppMap): Promise<TestPlan> {
  const appMapJson = JSON.stringify(appMap);
  const knownIds = new Set(appMap.elements.map((e) => e.id));
  const messages: LlmMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
    { role: 'user', content: buildPlannerUserPrompt(appMapJson) },
  ];

  // First attempt
  const response = await callLlm({ messages, jsonMode: true, maxTokens: 4000 });
  const firstResult = validatePlanResponse(response.content, knownIds);
  if (firstResult.ok) return firstResult.plan;

  // Self-repair (one attempt)
  const repairMessages: LlmMessage[] = [
    ...messages,
    { role: 'assistant', content: response.content },
    {
      role: 'user',
      content: `Your previous response failed validation.\n\nErrors (${firstResult.kind}):\n${firstResult.detail}\n\nReturn ONLY the corrected JSON object. No prose, no markdown, no code fences.`,
    },
  ];

  const repairResponse = await callLlm({ messages: repairMessages, jsonMode: true, maxTokens: 4000 });
  const repairResult = validatePlanResponse(repairResponse.content, knownIds);
  if (repairResult.ok) return repairResult.plan;

  // Graceful degradation for reference-only errors after repair
  if (repairResult.kind === 'references') {
    const parsed: unknown = JSON.parse(repairResponse.content);
    const schemaResult = TestPlanSchema.safeParse(parsed);
    if (schemaResult.success) {
      const validCases = schemaResult.data.testCases.filter((tc) =>
        tc.steps.every((s) => !s.elementId || knownIds.has(s.elementId)),
      );
      if (validCases.length > 0) {
        console.warn(
          `[Planner] Dropped ${schemaResult.data.testCases.length - validCases.length} test case(s) with hallucinated element IDs: ${repairResult.detail}`,
        );
        return { testCases: validCases };
      }
    }
  }

  throw new LlmError('BAD_RESPONSE', 'Planner failed after self-repair attempt', {
    originalError: firstResult.detail,
    repairError: repairResult.detail,
  });
}
