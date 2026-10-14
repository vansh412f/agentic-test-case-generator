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
  | { ok: false; kind: 'syntax' | 'schema'; detail: string }
  | { ok: false; kind: 'references'; detail: string; plan: TestPlan; badCaseIndexes: Set<number> };

function validateAndNormalizePlan(
  content: string,
  knownIds: Set<string>,
  appMapUrl: string,
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

  // 3. Post-parse normalization:
  // - Assign sequential IDs (tc-1, tc-2, ...) so LLM duplicates never cause overwrites
  // - Resolve relative navigate URLs against appMap.url
  // - Check elementId references against knownIds
  const badCaseIndexes = new Set<number>();
  const invalidRefs: Array<{ position: number; llmId: string; title: string; badIds: string[] }> = [];

  result.data.testCases.forEach((tc, idx) => {
    const llmId = tc.id;
    const title = tc.title;
    tc.id = `tc-${idx + 1}`;

    for (const step of tc.steps) {
      if (step.action === 'navigate' && step.value) {
        if (!step.value.startsWith('http://') && !step.value.startsWith('https://')) {
          try {
            step.value = new URL(step.value, appMapUrl).href;
          } catch {
            // Keep original if URL parsing fails
          }
        }
      }
    }

    const badIds = tc.steps
      .map((s) => s.elementId)
      .filter((id): id is string => id !== null && !knownIds.has(id));
    if (badIds.length > 0) {
      badCaseIndexes.add(idx);
      invalidRefs.push({ position: idx + 1, llmId, title, badIds: [...new Set(badIds)] });
    }
  });

  if (invalidRefs.length > 0) {
    const detail = invalidRefs
      .map(
        (r) =>
          `Test case #${r.position} "${r.title}" (your id: "${r.llmId}") references element IDs that do not exist in the App Map: ${r.badIds.join(', ')}. Use only IDs present in the App Map, or set elementId to null for text/URL assertions.`,
      )
      .join('\n');
    return { ok: false, kind: 'references', detail, plan: result.data, badCaseIndexes };
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

  const salvagePlan = (res: Extract<ValidationResult, { kind: 'references' }>): TestPlan | null => {
    const validCases = res.plan.testCases.filter((_, idx) => !res.badCaseIndexes.has(idx));
    if (validCases.length > 0) {
      validCases.forEach((tc, idx) => {
        tc.id = `tc-${idx + 1}`;
      });
      console.warn(
        `[Planner] Dropped ${res.badCaseIndexes.size} test case(s) with hallucinated element IDs: ${res.detail}`,
      );
      return { testCases: validCases };
    }
    return null;
  };

  // First attempt
  const response = await callLlm({ messages, jsonMode: true, maxTokens: 4000 });
  const firstResult = validateAndNormalizePlan(response.content, knownIds, appMap.url);
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
  const repairResult = validateAndNormalizePlan(repairResponse.content, knownIds, appMap.url);
  if (repairResult.ok) return repairResult.plan;

  // Graceful degradation for reference-only errors after repair
  if (repairResult.kind === 'references') {
    const salvaged = salvagePlan(repairResult);
    if (salvaged) return salvaged;
  }

  // Fallback: If repair failed structurally but firstResult was only references, salvage from firstResult
  if (firstResult.kind === 'references') {
    const salvaged = salvagePlan(firstResult);
    if (salvaged) return salvaged;
  }

  throw new LlmError('BAD_RESPONSE', 'Planner failed after self-repair attempt', {
    originalError: firstResult.detail,
    repairError: repairResult.detail,
  });
}
