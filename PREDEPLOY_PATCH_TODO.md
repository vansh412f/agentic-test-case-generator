# Predeploy Patch: Unprovided Password Guard

## Status & Current Pointer
- **CURRENT POINTER**: Complete (All stages W0–W5 implemented and verified)
- **Status**: Completed
- **Branch**: main at 3995aaf (with working tree patch)

---

## Stages Checklist

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

---

## Files Touched
- `PREDEPLOY_PATCH_TODO.md` (new tracking doc)
- `backend/src/agent/steps/planner.ts` (W1: `enforceUnprovidedPasswordGuard`, unprovided password ID computation, `finalizePlan` wiring; W2: prompt injection and conditioned `promptB`)
- `backend/src/agent/prompts/plannerPrompt.ts` (W2: added STRICT RULES item 16 for PASSWORD FIELDS)
- `backend/scratch/testPredeploy.ts` (W3: added regression tests P7–P11)
- `Readme.md` (W4: added unprovided password explanation sentence to test-data description)

---

## Verification Log
- **W0 Findings**:
  - `backend/src/agent/testData.ts`: `resolveTestData` iterates over entries, skipping any entry where `!entry.value || entry.value.trim().length === 0` or where `resolveElementRef` returns undefined. Thus, an element is provided if and only if `resolvedData.fills.has(elementId)`.
  - `backend/src/crawler/observe.ts`: `canFill = formFields.length > 0 && formFields.every((f) => resolvedData.fills.has(f.id))`. If any visible input/textarea/select lacks an entry in `resolvedData.fills`, filled submit is skipped entirely. When executed, values are strictly retrieved from `resolvedData.fills.get(f.id)!` (and resolved against `resolvedData.secrets` if secret placeholder). No invented values are generated or typed in `observe.ts`.
  - `backend/src/agent/steps/planner.ts`: `finalizePlan` executes on all plan paths (dual-call, single-call, repair, expansion, salvage). `enforceTestData` currently filters secret assertions and replaces non-negative fills or non-empty negative fills. The zero-plan guard throws `LlmError('BAD_RESPONSE')` immediately following intent stripping.
- **W1 Execution**:
  - Implemented `enforceUnprovidedPasswordGuard(plan: TestPlan, unprovidedPasswordIds: ReadonlySet<string>): TestPlan`.
  - Drops test cases where any step action is `fill` or `select` targeting an unprovided password element ID with a non-empty string value (`value !== null && value !== undefined && value !== ''`).
  - Emits console.warn with count and dropped titles: `[Planner] Dropped N test case(s) attempting to fill unprovided password fields: ...`.
  - Re-indexes and caps plan with `capAndRenumberTestPlan(plan)`.
  - Wired into `finalizePlan` immediately after `enforceTestData` and before intent stripping / zero-plan guard.
- **W2 Execution**:
  - Added STRICT RULES rule 16 to `backend/src/agent/prompts/plannerPrompt.ts`.
  - Formed and injected `PASSWORD FIELDS WITHOUT PROVIDED VALUES: ...` into `userPrompt` when unprovided password fields exist.
  - Conditioned `promptB` negative credential guidance on test data availability.
- **W3 Execution**:
  - Added test cases P7 through P11 in `backend/scratch/testPredeploy.ts`.
  - All 11 tests (P1–P11) pass cleanly.
- **W4 Execution**:
  - Added sentence to `Readme.md`: *"Password fields without a user-provided value are never filled with invented values — such forms are covered only with empty/validation cases."* under "Accepts per-site test data without persisting secrets server-side".
- **W5 Verification Results**:
  - `pnpm run typecheck`: PASS (`tsc --noEmit`, exit 0)
  - `pnpm exec tsx scratch/testPredeploy.ts`: PASS (11/11 tests pass, exit 0)
  - `pnpm exec tsx scratch/testPhase12.ts`: PASS (all 10 assertions pass, exit 0)
  - `pnpm exec tsx scratch/testPhase12Legacy.ts`: PASS (all 14 assertions pass, exit 0)
  - `pnpm exec tsx scratch/testQF2.ts`: PASS (all 10 groups pass, exit 0)
  - `pnpm exec tsx scratch/testPhase9A1.ts`: PASS (all 8 suites pass, exit 0)
  - `pnpm exec tsx scratch/testFallbackChains.ts`: PASS (all 9 test suites pass, exit 0)
  - `git diff --check`: PASS (no whitespace or git syntax issues)
  - Zero frontend files touched.
