import type { z } from 'zod';
import { callLlm } from '../../llm/client.ts';
import { LlmError } from '../../llm/types.ts';
import type { LlmMessage } from '../../llm/types.ts';
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserPrompt, TestPlanSchema, type PlanStep, type TestCase } from '../prompts/plannerPrompt.ts';
import type { TestPlan } from '../prompts/plannerPrompt.ts';
import type { AppMap, InteractiveElement, Observation } from '../../crawler/types.ts';
import type { ElementRef, TestDataEntry } from '../../api/schemas.ts';
import { toPlannerView } from '../plannerView.ts';
import { buildPlanCacheKey, getCachedPlan, setCachedPlan } from '../planCache.ts';
import { MAX_AI_TEST_CASES } from '../run.config.ts';
import { resolveTestData, resolveElementRef, type ResolvedTestData } from '../testData.ts';

function formatZodErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
}

export type ValidationResult =
  | { ok: true; plan: TestPlan }
  | { ok: false; kind: 'syntax' | 'schema'; detail: string }
  | { ok: false; kind: 'references'; detail: string; plan: TestPlan; badCaseIndexes: Set<number> };

function serializeObservations(observations?: Observation[]): string | undefined {
  if (!observations || observations.length === 0) return undefined;
  const obsList = observations.map((o) => ({
    ...o,
    visibleTexts: o.visibleTexts ? o.visibleTexts.map((t) => (t.length > 100 ? t.slice(0, 100) : t)) : [],
  }));

  let json = JSON.stringify(obsList);
  while (json.length > 6000 && obsList.length > 1) {
    obsList.pop();
    json = JSON.stringify(obsList);
  }
  if (json.length > 6000) {
    return json.slice(0, 6000);
  }
  return json;
}

export function validateAndNormalizePlan(
  content: string,
  knownIds: Set<string>,
  appMapUrl: string,
  options?: { cap?: boolean },
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

    const badIds = tc.steps
      .map((s) => s.elementId)
      .filter((id): id is string => id !== null && !knownIds.has(id));
    if (badIds.length > 0) {
      badCaseIndexes.add(idx);
      invalidRefs.push({
        position: idx + 1,
        llmId,
        title,
        badIds: [...new Set(badIds)],
      });
    }
  });

  if (invalidRefs.length > 0) {
    const detail = invalidRefs
      .map((r) =>
        `Test case #${r.position} "${r.title}" (your id: "${r.llmId}") references element IDs that do not exist in the App Map: ${r.badIds.join(', ')}. Use only IDs present in the App Map, or set elementId to null for text/URL assertions.`
      )
      .join('\n');
    return { ok: false, kind: 'references', detail, plan: result.data, badCaseIndexes };
  }

  if (options?.cap !== false) {
    capAndRenumberTestPlan(result.data);
  }
  return { ok: true, plan: result.data };
}

function isNavigationOnlyTest(tc: TestCase, elementsMap: Map<string, InteractiveElement>): boolean {
  const nonAssertSteps = tc.steps.filter((s) => !s.action.startsWith('assert_'));
  const assertSteps = tc.steps.filter((s) => s.action.startsWith('assert_'));

  if (nonAssertSteps.length === 0) return false;

  const allNonAssertAreLinks = nonAssertSteps.every((s) => {
    if (s.action === 'navigate') return true;
    if (s.action === 'click' && s.elementId) {
      const el = elementsMap.get(s.elementId);
      return el?.type === 'link' || el?.tagName?.toLowerCase() === 'a' || Boolean(el?.href);
    }
    return false;
  });

  const allAssertsAreUrl = assertSteps.length > 0 && assertSteps.every((s) => s.action === 'assert_url');

  return allNonAssertAreLinks && allAssertsAreUrl;
}

function filterNavigationOnlyTests(testCases: TestCase[], appMap: AppMap): TestCase[] {
  const elementsMap = new Map(appMap.elements.map((e) => [e.id, e]));
  let seenNav = false;
  return testCases.filter((tc) => {
    if (isNavigationOnlyTest(tc, elementsMap)) {
      if (!seenNav) {
        seenNav = true;
        return true;
      }
      return false;
    }
    return true;
  });
}

export function capAndRenumberTestPlan(plan: TestPlan): TestPlan {
  plan.testCases = plan.testCases.slice(0, MAX_AI_TEST_CASES);
  plan.testCases.forEach((tc, idx) => {
    tc.id = `tc-${idx + 1}`;
  });
  return plan;
}

export function enforceTestData(plan: TestPlan, fills: Map<string, string>): TestPlan {
  if (fills.size === 0) return plan;
  const keptCases: TestCase[] = [];
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
    if (tc.steps.some((s) => s.action.startsWith('assert_'))) {
      keptCases.push(tc);
    }
  }
  plan.testCases = keptCases;
  capAndRenumberTestPlan(plan);
  return plan;
}

export interface PlanTestsOptions {
  testData?: TestDataEntry[];
  focus?: ElementRef[];
  keepHiddenIds?: Set<string>;
  extraPromptBlock?: string;
  signal?: AbortSignal;
  fresh?: boolean;
  tokenBudget?: number;
  consumedTokens?: () => number;
  callLlmImpl?: typeof callLlm;
}

export async function planTests(appMap: AppMap, options?: PlanTestsOptions): Promise<TestPlan> {
  const doCallLlm = options?.callLlmImpl ?? callLlm;

  let resolvedData: ResolvedTestData | undefined;
  if (options?.testData && options.testData.length > 0) {
    resolvedData = resolveTestData(appMap, options.testData);
  }

  let effectiveKeepHidden = options?.keepHiddenIds;
  const resolvedFocus = (options?.focus ?? [])
    .map((ref) => resolveElementRef(appMap, ref))
    .filter((el): el is InteractiveElement => el !== undefined);

  if (resolvedFocus.length > 0) {
    effectiveKeepHidden = new Set(appMap.elements.map((e) => e.id));
  }

  const serializedObservations = serializeObservations(appMap.observations);

  const plannerView = toPlannerView(appMap, { keepHiddenIds: effectiveKeepHidden });
  const cacheKey = buildPlanCacheKey({
    view: plannerView,
    data: resolvedData ? Object.fromEntries(resolvedData.fills.entries()) : undefined,
    focus: resolvedFocus.length > 0 ? resolvedFocus.map((f) => f.id) : undefined,
    observations: serializedObservations,
  });

  if (!options?.fresh) {
    const cached = getCachedPlan(cacheKey);
    if (cached) {
      console.log('[Planner] cache hit');
      return cached;
    }
  }

  const appMapJson = JSON.stringify(plannerView);
  const knownIds = new Set(appMap.elements.map((e) => e.id));
  let userPrompt = buildPlannerUserPrompt(appMapJson);
  if (serializedObservations) {
    userPrompt += `\n\nOBSERVED FACTS (recorded by actually driving this page — assertions must not contradict these):\n${serializedObservations}`;
  }
  if (resolvedData?.promptBlock) {
    userPrompt += `\n\n${resolvedData.promptBlock}`;
  }
  if (resolvedFocus.length > 0) {
    const focusList = resolvedFocus
      .map((el) => {
        const label = el.text ?? el.ariaLabel ?? el.placeholder ?? el.name ?? el.id;
        return `${el.id} ("${label}")`;
      })
      .join(', ');
    userPrompt += `\n\nFOCUS: generate 2–4 test cases focused on these elements: ${focusList}.\nEvery test case must start by interacting with a focus element and verify what it reveals.`;
  }
  if (options?.extraPromptBlock) {
    userPrompt += `\n\n${options.extraPromptBlock}`;
  }

  const userChars = userPrompt.length;
  const sysChars = PLANNER_SYSTEM_PROMPT.length;
  const totalChars = userChars + sysChars;

  const isDual = resolvedFocus.length === 0;
  const dualEst = Math.ceil((totalChars * 2) / 3.5 + 5500);
  const singleEst = Math.ceil(totalChars / 3.5 + 3500);

  const budgetExceededForDual = Boolean(
    isDual &&
      options?.tokenBudget &&
      options.tokenBudget > 0 &&
      options?.consumedTokens &&
      options.consumedTokens() + dualEst > options.tokenBudget,
  );

  const useDualCall = isDual && !budgetExceededForDual;
  if (isDual && budgetExceededForDual) {
    console.log('[Planner] budget: single-call');
  }

  const est = useDualCall ? dualEst : singleEst;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Planner] est=${est}`);
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: PLANNER_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const visibleCount = appMap.elements.filter((e) => e.isVisible !== false).length;

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

  const finalizePlan = async (
    rawPlan: TestPlan,
    isSalvaged: boolean,
    assistantResponseContent?: string,
    allowExpansion = false,
  ): Promise<TestPlan> => {
    let plan = rawPlan;
    // 1. Deterministic pass: keep only the first navigation-only test
    plan.testCases = filterNavigationOnlyTests(plan.testCases, appMap);
    capAndRenumberTestPlan(plan);

    // 2. Expansion call if allowExpansion && < 5 cases AND >= 4 visible interactive elements AND meter <= 50%
    const budgetExceeded = Boolean(
      options?.tokenBudget &&
        options.tokenBudget > 0 &&
        options?.consumedTokens &&
        options.consumedTokens() > options.tokenBudget * 0.5,
    );
    if (allowExpansion && !isSalvaged && plan.testCases.length < 5 && visibleCount >= 4 && assistantResponseContent && !budgetExceeded) {
      try {
        const expansionMessages: LlmMessage[] = [
          ...messages,
          { role: 'assistant', content: assistantResponseContent },
          {
            role: 'user',
            content: `The plan has ${plan.testCases.length} test cases. Add up to ${MAX_AI_TEST_CASES - plan.testCases.length} more that cover categories not yet covered. Return the COMPLETE JSON plan.`,
          },
        ];
        const expansionResponse = await doCallLlm({
          messages: expansionMessages,
          jsonMode: true,
          maxTokens: 3500,
          tier: 'reasoning',
          purpose: 'expand',
          signal: options?.signal,
        });
        const expansionResult = validateAndNormalizePlan(
          expansionResponse.content,
          knownIds,
          appMap.url,
        );
        if (expansionResult.ok && expansionResult.plan.testCases.length > plan.testCases.length) {
          plan = expansionResult.plan;
          plan.testCases = filterNavigationOnlyTests(plan.testCases, appMap);
          capAndRenumberTestPlan(plan);
        }
      } catch (expErr) {
        console.warn(`[Planner] Expansion call failed: ${expErr instanceof Error ? expErr.message : String(expErr)}`);
      }
    }

    if (resolvedData && resolvedData.fills.size > 0) {
      enforceTestData(plan, resolvedData.fills);
    }

    // Cache rules: never cache salvaged plans; never cache plans with < 3 cases unless page has <= 3 visible elements
    const canCache = !isSalvaged && !(plan.testCases.length < 3 && visibleCount > 3);
    if (canCache) {
      setCachedPlan(cacheKey, plan);
    }

    return plan;
  };

  if (useDualCall) {
    const promptA = `${userPrompt}\n\nASSIGNMENT: plan up to 6 core cases — primary happy paths end-to-end, key navigation, main content visibility. Prefer cases grounded in OBSERVED FACTS.`;
    const promptB = `${userPrompt}\n\nASSIGNMENT: plan up to 5 negative / validation / edge cases — empty submits, invalid input, counts, visibility of secondary elements. Prefer cases grounded in OBSERVED FACTS.`;

    const [settledA, settledB] = await Promise.allSettled([
      doCallLlm({
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: promptA },
        ],
        jsonMode: true,
        maxTokens: 3000,
        tier: 'reasoning',
        purpose: 'plan',
        signal: options?.signal,
      }),
      doCallLlm({
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: promptB },
        ],
        jsonMode: true,
        maxTokens: 2500,
        tier: 'fast',
        purpose: 'plan',
        signal: options?.signal,
      }),
    ]);

    function extractCases(
      settled: PromiseSettledResult<{ content: string }>,
      side: string,
    ): {
      cases: TestCase[];
      salvaged: boolean;
      content?: string;
      res?: ValidationResult;
    } {
      if (settled.status === 'rejected') {
        console.warn(`[Planner] Dual-call ${side} rejected:`, settled.reason);
        return { cases: [], salvaged: false };
      }
      const res = validateAndNormalizePlan(settled.value.content, knownIds, appMap.url, { cap: false });
      if (res.ok) return { cases: res.plan.testCases, salvaged: false, content: settled.value.content, res };
      if (res.kind === 'references') {
        const validCases = res.plan.testCases.filter((_, idx) => !res.badCaseIndexes.has(idx));
        console.warn(`[Planner] Dual-call ${side} references error; salvaged ${validCases.length} cases`);
        return { cases: validCases, salvaged: true, content: settled.value.content, res };
      }
      console.warn(`[Planner] Dual-call ${side} failed (${res.kind}): ${res.detail.slice(0, 300)}`);
      return { cases: [], salvaged: false, content: settled.value.content, res };
    }

    let { cases: casesA, salvaged: salvagedA, content: contentA, res: resA } = extractCases(settledA, 'A');
    const { cases: casesB, salvaged: salvagedB } = extractCases(settledB, 'B');

    if (casesA.length === 0 && casesB.length === 0) {
      if (contentA && resA && !resA.ok) {
        console.warn(`[Planner] Both sides empty. Attempting self-repair on reasoning side A (${resA.kind})...`);
        const repairMessages: LlmMessage[] = [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: promptA },
          { role: 'assistant', content: contentA },
          {
            role: 'user',
            content: `Your previous response failed validation.\n\nErrors (${resA.kind}):\n${resA.detail}\n\nReturn ONLY the corrected JSON object. No prose, no markdown, no code fences.`,
          },
        ];
        try {
          const repairResponse = await doCallLlm({
            messages: repairMessages,
            jsonMode: true,
            maxTokens: 3000,
            tier: 'reasoning',
            purpose: 'repair',
            signal: options?.signal,
          });
          const repairResult = validateAndNormalizePlan(repairResponse.content, knownIds, appMap.url, { cap: false });
          if (repairResult.ok) {
            casesA = repairResult.plan.testCases;
          } else if (repairResult.kind === 'references') {
            casesA = repairResult.plan.testCases.filter((_, idx) => !repairResult.badCaseIndexes.has(idx));
            salvagedA = true;
          }
        } catch (repairErr) {
          console.warn('[Planner] Self-repair failed:', repairErr);
        }
      }
    }

    if (casesA.length === 0 && casesB.length === 0) {
      const errorA = settledA.status === 'rejected' ? settledA.reason : resA && !resA.ok ? resA.detail : 'Validation failed for A';
      const errorB = settledB.status === 'rejected' ? settledB.reason : 'Validation failed for B';
      throw new LlmError('BAD_RESPONSE', 'Planner dual-call produced no valid test cases', {
        errorA: String(errorA),
        errorB: String(errorB),
      });
    }

    const seenTitles = new Set<string>();
    const mergedCases: TestCase[] = [];
    for (const tc of [...casesA, ...casesB]) {
      const norm = tc.title.trim().toLowerCase();
      if (!seenTitles.has(norm)) {
        seenTitles.add(norm);
        mergedCases.push(tc);
      }
    }

    const isAnySalvaged = salvagedA || salvagedB;
    return finalizePlan({ testCases: mergedCases }, isAnySalvaged, JSON.stringify({ testCases: mergedCases }), true);
  }

  // Single-call attempt (focus mode or fallback)
  const response = await doCallLlm({
    messages,
    jsonMode: true,
    maxTokens: 3500,
    tier: 'reasoning',
    purpose: 'plan',
    signal: options?.signal,
  });
  const firstResult = validateAndNormalizePlan(response.content, knownIds, appMap.url);
  if (firstResult.ok) {
    return finalizePlan(firstResult.plan, false, response.content, true);
  }

  // Self-repair (one attempt)
  console.warn(`[Planner] Attempt 1 failed (${firstResult.kind}): ${firstResult.detail.slice(0, 300)}`);

  const repairMessages: LlmMessage[] = [
    ...messages,
    { role: 'assistant', content: response.content },
    {
      role: 'user',
      content: `Your previous response failed validation.\n\nErrors (${firstResult.kind}):\n${firstResult.detail}\n\nReturn ONLY the corrected JSON object. No prose, no markdown, no code fences.`,
    },
  ];

  const repairResponse = await doCallLlm({
    messages: repairMessages,
    jsonMode: true,
    maxTokens: 3500,
    tier: 'reasoning',
    purpose: 'repair',
    signal: options?.signal,
  });
  const repairResult = validateAndNormalizePlan(repairResponse.content, knownIds, appMap.url);
  if (repairResult.ok) {
    return finalizePlan(repairResult.plan, false, repairResponse.content, false);
  }

  // Graceful degradation for reference-only errors after repair
  if (repairResult.kind === 'references') {
    const salvaged = salvagePlan(repairResult);
    if (salvaged) {
      return finalizePlan(salvaged, true, undefined, false);
    }
  }

  // Fallback: If repair failed structurally but firstResult was only references, salvage from firstResult
  if (firstResult.kind === 'references') {
    const salvaged = salvagePlan(firstResult);
    if (salvaged) {
      return finalizePlan(salvaged, true, undefined, false);
    }
  }

  throw new LlmError('BAD_RESPONSE', 'Planner failed after self-repair attempt', {
    originalError: firstResult.detail,
    repairError: repairResult.detail,
  });
}
