import type { z } from 'zod';
import { callLlm } from '../../llm/client.ts';
import { LlmError } from '../../llm/types.ts';
import type { LlmMessage } from '../../llm/types.ts';
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserPrompt, TestPlanSchema, type PlanStep } from '../prompts/plannerPrompt.ts';
import type { TestPlan } from '../prompts/plannerPrompt.ts';
import type { AppMap, InteractiveElement } from '../../crawler/types.ts';
import type { ElementRef, TestDataEntry } from '../../api/schemas.ts';
import { canonicalPageUrl } from '../../crawler/mergeAppMaps.ts';
import { toPlannerView } from '../plannerView.ts';
import { buildPlanCacheKey, getCachedPlan, setCachedPlan } from '../planCache.ts';
import { MAX_TEST_CASES } from '../run.config.ts';
import { resolveTestData, resolveElementRef, type ResolvedTestData } from '../testData.ts';

function formatZodErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
}

export interface PageScope {
  pageOf: Map<string, string>;
  aliases: Map<string, string>;
}

export function buildPageScope(appMap: AppMap): PageScope | null {
  if (!appMap.pages || appMap.pages.length < 2) return null;
  const pageUrls = appMap.pages.map((p) => canonicalPageUrl(p.url));
  const aliases = new Map<string, string>();
  appMap.pages.forEach((p, i) => {
    const target = pageUrls[i];
    aliases.set(canonicalPageUrl(p.requestedUrl), target);
    aliases.set(pageUrls[i], target);
  });
  const pageOf = new Map<string, string>();
  for (const element of appMap.elements) {
    const pageIndex = (element.page ?? 1) - 1;
    pageOf.set(element.id, pageUrls[pageIndex] ?? pageUrls[0]);
  }
  return { pageOf, aliases };
}

export type ValidationResult =
  | { ok: true; plan: TestPlan }
  | { ok: false; kind: 'syntax' | 'schema'; detail: string }
  | { ok: false; kind: 'references'; detail: string; plan: TestPlan; badCaseIndexes: Set<number> };

export function validateAndNormalizePlan(
  content: string,
  knownIds: Set<string>,
  appMapUrl: string,
  pageScope: PageScope | null = null,
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
  const invalidRefs: Array<{
    position: number;
    llmId: string;
    title: string;
    badIds: string[];
    offPage: string[];
  }> = [];

  result.data.testCases.forEach((tc, idx) => {
    const llmId = tc.id;
    const title = tc.title;
    tc.id = `tc-${idx + 1}`;

    // Strip redundant leading navigate to crawled page if emitted
    if (
      tc.steps.length > 1 &&
      tc.steps[0].action === 'navigate' &&
      tc.steps[0].value &&
      (tc.steps[0].value === '/' ||
        tc.steps[0].value === appMapUrl ||
        tc.steps[0].value.replace(/\/$/, '') === appMapUrl.replace(/\/$/, '') ||
        new URL(tc.steps[0].value, appMapUrl).href.replace(/\/$/, '') === appMapUrl.replace(/\/$/, ''))
    ) {
      tc.steps.shift();
    }

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

    const offPage: string[] = [];
    if (pageScope) {
      const resolve = (u: string) => {
        const k = canonicalPageUrl(u, appMapUrl);
        return pageScope.aliases.get(k) ?? k;
      };
      let current = resolve(appMapUrl);
      for (const step of tc.steps) {
        if (step.action === 'navigate' && step.value) {
          current = resolve(step.value);
          continue;
        }
        const home = step.elementId ? pageScope.pageOf.get(step.elementId) : undefined;
        if (step.elementId && home && home !== current) {
          offPage.push(`${step.elementId} (on ${home})`);
        }
      }
    }

    const badIds = tc.steps
      .map((s) => s.elementId)
      .filter((id): id is string => id !== null && !knownIds.has(id));
    if (badIds.length > 0 || offPage.length > 0) {
      badCaseIndexes.add(idx);
      invalidRefs.push({
        position: idx + 1,
        llmId,
        title,
        badIds: [...new Set(badIds)],
        offPage,
      });
    }
  });

  if (invalidRefs.length > 0) {
    const detail = invalidRefs
      .flatMap((r) => {
        const msgs: string[] = [];
        if (r.badIds.length > 0) {
          msgs.push(
            `Test case #${r.position} "${r.title}" (your id: "${r.llmId}") references element IDs that do not exist in the App Map: ${r.badIds.join(', ')}. Use only IDs present in the App Map, or set elementId to null for text/URL assertions.`,
          );
        }
        if (r.offPage.length > 0) {
          msgs.push(
            `Test case #${r.position} "${r.title}" (your id: "${r.llmId}") uses elements from another page without navigating there first: ${r.offPage.join(', ')}. Add a navigate step to that page URL before using them.`,
          );
        }
        return msgs;
      })
      .join('\n');
    return { ok: false, kind: 'references', detail, plan: result.data, badCaseIndexes };
  }

  capAndRenumberTestPlan(result.data);
  return { ok: true, plan: result.data };
}

export function capAndRenumberTestPlan(plan: TestPlan): TestPlan {
  plan.testCases = plan.testCases.slice(0, MAX_TEST_CASES);
  plan.testCases.forEach((tc, idx) => {
    tc.id = `tc-${idx + 1}`;
  });
  return plan;
}

export function enforceTestData(plan: TestPlan, fills: Map<string, string>): TestPlan {
  if (fills.size === 0) return plan;
  for (const tc of plan.testCases) {
    const keptSteps: PlanStep[] = [];
    for (const step of tc.steps) {
      if ((step.action === 'fill' || step.action === 'select') && step.elementId && fills.has(step.elementId)) {
        step.value = fills.get(step.elementId)!;
      }
      if (
        (step.action === 'assert_visible' || step.action === 'assert_text' || step.action === 'assert_url') &&
        step.value &&
        /__AGT_SECRET_\d+__/.test(step.value)
      ) {
        continue;
      }
      keptSteps.push(step);
    }
    tc.steps = keptSteps;
  }
  return plan;
}

export interface PlanTestsOptions {
  testData?: TestDataEntry[];
  focus?: ElementRef[];
  keepHiddenIds?: Set<string>;
  extraPromptBlock?: string;
}

export async function planTests(appMap: AppMap, options?: PlanTestsOptions): Promise<TestPlan> {
  let resolvedData: ResolvedTestData | undefined;
  if (options?.testData && options.testData.length > 0) {
    resolvedData = resolveTestData(appMap, options.testData);
  }

  let effectiveKeepHidden = options?.keepHiddenIds;
  if (options?.focus && options.focus.length > 0) {
    effectiveKeepHidden = new Set(appMap.elements.map((e) => e.id));
  }

  const plannerView = toPlannerView(appMap, { keepHiddenIds: effectiveKeepHidden });
  const cacheKey = buildPlanCacheKey({
    view: plannerView,
    data: resolvedData ? Object.fromEntries(resolvedData.fills.entries()) : undefined,
    focus: options?.focus ? options.focus.map((f) => f.elementId) : undefined,
  });

  const cached = getCachedPlan(cacheKey);
  if (cached) {
    console.log('[Planner] cache hit');
    return cached;
  }

  const appMapJson = JSON.stringify(plannerView);
  const knownIds = new Set(appMap.elements.map((e) => e.id));
  const pageScope = buildPageScope(appMap);
  let userPrompt = buildPlannerUserPrompt(appMapJson, { multiPage: pageScope !== null });
  if (resolvedData?.promptBlock) {
    userPrompt += `\n\n${resolvedData.promptBlock}`;
  }
  if (options?.focus && options.focus.length > 0) {
    const resolvedFocus = options.focus
      .map((ref) => resolveElementRef(appMap, ref))
      .filter((el): el is InteractiveElement => el !== undefined);
    if (resolvedFocus.length > 0) {
      const focusList = resolvedFocus
        .map((el) => {
          const label = el.ariaLabel ?? el.placeholder ?? el.name ?? el.text ?? el.id;
          return `${el.id} ("${label}")`;
        })
        .join(', ');
      userPrompt += `\n\nFOCUS: generate 2–4 test cases focused on these elements: ${focusList}.\nEvery test case must start by interacting with a focus element and verify what it reveals.`;
    }
  }
  if (options?.extraPromptBlock) {
    userPrompt += `\n\n${options.extraPromptBlock}`;
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const salvagePlan = (res: Extract<ValidationResult, { kind: 'references' }>): TestPlan | null => {
    const validCases = res.plan.testCases.filter((_, idx) => !res.badCaseIndexes.has(idx));
    if (validCases.length > 0) {
      console.warn(
        `[Planner] Dropped ${res.badCaseIndexes.size} test case(s) with hallucinated element IDs: ${res.detail}`,
      );
      const salvaged: TestPlan = { testCases: validCases };
      capAndRenumberTestPlan(salvaged);
      return salvaged;
    }
    return null;
  };

  const applyFillsAndCache = (plan: TestPlan): TestPlan => {
    if (resolvedData && resolvedData.fills.size > 0) {
      enforceTestData(plan, resolvedData.fills);
    }
    setCachedPlan(cacheKey, plan);
    return plan;
  };

  // First attempt
  const response = await callLlm({ messages, jsonMode: true, maxTokens: 3000, tier: 'reasoning' });
  const firstResult = validateAndNormalizePlan(response.content, knownIds, appMap.url, pageScope);
  if (firstResult.ok) {
    return applyFillsAndCache(firstResult.plan);
  }

  // Self-repair (one attempt)
  console.warn(`[Planner] Attempt 1 failed (${firstResult.kind}):`, JSON.stringify(firstResult, null, 2));

  const repairMessages: LlmMessage[] = [
    ...messages,
    { role: 'assistant', content: response.content },
    {
      role: 'user',
      content: `Your previous response failed validation.\n\nErrors (${firstResult.kind}):\n${firstResult.detail}\n\nReturn ONLY the corrected JSON object. No prose, no markdown, no code fences.`,
    },
  ];

  const repairResponse = await callLlm({ messages: repairMessages, jsonMode: true, maxTokens: 3000, tier: 'reasoning' });
  const repairResult = validateAndNormalizePlan(repairResponse.content, knownIds, appMap.url, pageScope);
  if (repairResult.ok) {
    return applyFillsAndCache(repairResult.plan);
  }

  // Graceful degradation for reference-only errors after repair
  if (repairResult.kind === 'references') {
    const salvaged = salvagePlan(repairResult);
    if (salvaged) {
      return applyFillsAndCache(salvaged);
    }
  }

  // Fallback: If repair failed structurally but firstResult was only references, salvage from firstResult
  if (firstResult.kind === 'references') {
    const salvaged = salvagePlan(firstResult);
    if (salvaged) {
      return applyFillsAndCache(salvaged);
    }
  }

  throw new LlmError('BAD_RESPONSE', 'Planner failed after self-repair attempt', {
    originalError: firstResult.detail,
    repairError: repairResult.detail,
  });
}
