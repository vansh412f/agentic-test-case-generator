# Predeploy Patch: Unprovided Password Guard & Addendum

## Status & Current Pointer
- **CURRENT POINTER**: Complete (Stages W0–W5 and Addendum A0–A6 fully implemented and verified)
- **Status**: Completed
- **Branch**: main at 3995aaf (with W0–W5 committed at dc7b6ae + Addendum A0–A6 working tree patch)

---

## Stages Checklist

### Core Patch (W0–W5)
- [x] **W0: Baseline reads & findings**
  - [x] `backend/src/agent/steps/planner.ts`: `enforceTestData`, `planTests` (`resolvedData`, `userPrompt`, `finalizePlan`, zero-plan guard).
  - [x] `backend/src/agent/testData.ts`: `resolveTestData` semantics (`fills` map populated only for non-empty provided entries).
  - [x] `backend/src/crawler/observe.ts`: filled-submit path confirmed read-only (only fills fields present in `resolvedData.fills`; never invents).
  - [x] `backend/scratch/testPredeploy.ts`: P3–P6 patterns reviewed.
- [x] **W1: Deterministic guard in `backend/src/agent/steps/planner.ts`**
  - [x] Implement exported pure function `enforceUnprovidedPasswordGuard(plan: TestPlan, unprovidedPasswordIds: ReadonlySet<string>): TestPlan`.
  - [x] Semantics: empty set returns plan; drop case if ANY step has action 'fill' | 'select', elementId in set, and value !== null/undefined/''; keep empty fills / omitted fills / asserts; capAndRenumberTestPlan; warn log one [Planner] line summary with count + titles.
  - [x] Compute `unprovidedPasswordIds`: `appMap.elements` where `(e.inputType ?? '').toLowerCase() === 'password' && !(resolvedData?.fills.has(e.id))`.
  - [x] Wire in `finalizePlan`: after `enforceTestData` and before intent stripping / zero-plan guard.
- [x] **W2: Prompt instruction**
  - [x] `backend/src/agent/prompts/plannerPrompt.ts`: Add rule 16 under STRICT RULES for PASSWORD FIELDS.
  - [x] `backend/src/agent/steps/planner.ts`: Append `PASSWORD FIELDS WITHOUT PROVIDED VALUES: ...` block to `userPrompt` when set is non-empty (matching focus label resolution).
  - [x] `backend/src/agent/steps/planner.ts`: Condition `promptB` negative wrong-credential instruction on test data being provided.
- [x] **W3: Regression tests in `backend/scratch/testPredeploy.ts`**
  - [x] P7: Case filling unprovided password with literal dropped; sibling survives and renumbers to tc-1.
  - [x] P8: Case with `fill ''` on unprovided password kept.
  - [x] P9: Case omitting fill (assert/submit/assert_url) on unprovided password kept.
  - [x] P10: Provided password unaffected (negative wrong-literal and positive secret placeholder survive).
  - [x] P11: Plan where every case fills unprovided password returns 0 cases from guard (triggers zero-plan guard in finalizePlan).
  - [x] Confirm P1–P6 pass unchanged.
- [x] **W4: README update**
  - [x] Add sentence to test-data behavior description in `Readme.md` (no line numbers, no changes to Measured Results).
- [x] **W5: Verification**
  - [x] `pnpm run typecheck`
  - [x] `pnpm exec tsx scratch/testPredeploy.ts`
  - [x] `pnpm exec tsx scratch/testPhase12.ts`
  - [x] `pnpm exec tsx scratch/testPhase12Legacy.ts`
  - [x] `pnpm exec tsx scratch/testQF2.ts`
  - [x] `pnpm exec tsx scratch/testPhase9A1.ts`
  - [x] `pnpm exec tsx scratch/testFallbackChains.ts`
  - [x] `git diff --check`, `git diff --stat`, `git status --short --branch`, confirm zero frontend files.

### Addendum (A0–A6)
- [x] **A0: Baseline reads**
  - [x] `validateAndNormalizePlan` in `backend/src/agent/steps/planner.ts`.
  - [x] `PlanStepSchema superRefine` in `backend/src/agent/prompts/plannerPrompt.ts`.
  - [x] Compiler `assert_visible`/`assert_text` branches in `backend/src/agent/steps/compiler.ts`.
  - [x] Generator fallback prompt in `backend/src/agent/prompts/generatorPrompt.ts`.
- [x] **A1: Deterministic normalization in `validateAndNormalizePlan`**
  - [x] Defensive walk before `safeParse` converting locator-less `assert_text` with non-empty string value to `assert_visible` (`elementId: null`).
  - [x] Single warning line: `[Planner] Normalized N locator-less assert_text step(s) to assert_visible.`
- [x] **A2: Prompt instruction**
  - [x] Add rule 17 (PAGE-LEVEL MESSAGES) to STRICT RULES in `backend/src/agent/prompts/plannerPrompt.ts`.
- [x] **A3: Interaction checks**
  - [x] `enforceTestData` secret redaction compatibility verified.
  - [x] References / salvage error path compatibility verified.
  - [x] Plan cache pre-storage normalization verified.
- [x] **A4: Regression tests in `backend/scratch/testPredeploy.ts`**
  - [x] P12: Locator-less `assert_text` with value normalizes to `assert_visible` (`ok: true`, `elementId: null`).
  - [x] P13: `assert_text` with known `elementId` remains unchanged (`ok: true`).
  - [x] P14: `assert_text` with valid `target` remains unchanged (`ok: true`).
  - [x] P15: Locator-less `assert_text` with empty string or null value is not converted and fails schema (`ok: false, kind: 'schema'`).
  - [x] P16: `assert_text` with hallucinated `elementId` is not converted and returns references error (`ok: false, kind: 'references'`).
  - [x] P17: Mixed plan: converted step survives while hallucinated case triggers references kind.
- [x] **A5: Two doc literal fixes in `docs/measurements/2026-10-model-benchmark.md`**
  - [x] SQLite database -> Supabase Postgres replacement.
  - [x] `MAX_TEST_CASES = 8` -> `MAX_AI_TEST_CASES = 8` replacement.
- [x] **A6: Full verification**
  - [x] `pnpm run typecheck`
  - [x] `pnpm exec tsx scratch/testPredeploy.ts`
  - [x] `pnpm exec tsx scratch/testPhase12.ts`
  - [x] `pnpm exec tsx scratch/testPhase12Legacy.ts`
  - [x] `pnpm exec tsx scratch/testQF2.ts`
  - [x] `pnpm exec tsx scratch/testPhase9A1.ts`

---

## Files Touched
- `PREDEPLOY_PATCH_TODO.md` (tracking doc)
- `backend/src/agent/steps/planner.ts` (`normalizeLocatorLessAssertText`, called in `validateAndNormalizePlan`)
- `backend/src/agent/prompts/plannerPrompt.ts` (Rule 17 in STRICT RULES)
- `backend/scratch/testPredeploy.ts` (P12–P17 regression tests)
- `docs/measurements/2026-10-model-benchmark.md` (2 literal string replacements)

---

## Verification Log
- **W0–W5**: Completed and committed in `fa755e2` and `dc7b6ae`. All 11 tests (P1–P11) passing.
- **A0 Baseline Reads**:
  - `PlanStepSchema superRefine`: confirms `assert_text` requires `elementId` or `target`, plus non-null/non-undefined value. `assert_visible` requires `elementId`, `target`, OR `value`.
  - `compiler.ts`: confirms `assert_visible` branch with no `elementId`/`target` compiles to `await expect(page.getByText(step.value)).toBeVisible()`.
  - `generatorPrompt.ts`: confirms example step `{ "action": "assert_visible", "elementId": null, "value": "Buy groceries" }` maps to `await expect(page.getByText("Buy groceries")).toBeVisible()`.
- **A1 Execution**:
  - Exported `normalizeLocatorLessAssertText(parsed: unknown): number` in `planner.ts`.
  - Defensively walks `parsed.testCases[].steps[]`. Converts when `action === 'assert_text'`, `elementId` is null/undefined/'', `target` is null/undefined, and `typeof value === 'string' && value.trim() !== ''`. Sets `action = 'assert_visible'` and `elementId = null` if undefined or empty string.
  - Emits single warning `[Planner] Normalized N locator-less assert_text step(s) to assert_visible.`
  - Called immediately after `JSON.parse` and before `TestPlanSchema.safeParse`.
- **A2 Execution**:
  - Added Rule 17 under STRICT RULES in `backend/src/agent/prompts/plannerPrompt.ts`.
- **A3 Interaction Checks**:
  1. `enforceTestData`: Lines 205–211 strip `__AGT_SECRET_\d+__` assertions for `assert_visible`, `assert_text`, and `assert_url` identically; converted steps remain fully covered.
  2. References / salvage: Normalization sets `elementId: null`. The references check filters out null `elementId`s, leaving cases with converted steps valid while cases with hallucinated IDs are correctly captured in `badCaseIndexes` with kind `'references'`.
  3. Cache: Normalization runs inside `validateAndNormalizePlan` before `safeParse` and plan return, so only normalized `assert_visible` plans are cached in `setCachedPlan`.
- **A4 Tests**:
  - P12 through P17 added to `testPredeploy.ts`. All 17 tests (P1–P17) pass.
- **A5 Doc Fixes**:
  - Replaced SQLite mention with Prisma / Supabase Postgres.
  - Replaced `MAX_TEST_CASES = 8` with `MAX_AI_TEST_CASES = 8`.
  - Diff against 3995aaf is exactly 2 changed lines. Zero occurrences of "SQLite".
- **A6 Verification Results**:
  - `pnpm run typecheck`: PASS (`tsc --noEmit`, exit 0)
  - `pnpm exec tsx scratch/testPredeploy.ts`: PASS (all 17 tests pass, exit 0)
  - `pnpm exec tsx scratch/testPhase12.ts`: PASS (all 10 assertions pass, exit 0)
  - `pnpm exec tsx scratch/testPhase12Legacy.ts`: PASS (all 14 assertions pass, exit 0)
  - `pnpm exec tsx scratch/testQF2.ts`: PASS (all 10 groups pass, exit 0)
  - `pnpm exec tsx scratch/testPhase9A1.ts`: PASS (all 8 suites pass, exit 0)
  - Zero frontend files touched.
