# Predeploy Patch: Unprovided Password Guard

## Status & Current Pointer
- **CURRENT POINTER**: W0 (Baseline reads complete; moving to W1)
- **Status**: In Progress
- **Branch**: main at 3995aaf

---

## Stages Checklist

- [x] **W0: Baseline reads & findings**
  - [x] `backend/src/agent/steps/planner.ts`: `enforceTestData`, `planTests` (`resolvedData`, `userPrompt`, `finalizePlan`, zero-plan guard).
  - [x] `backend/src/agent/testData.ts`: `resolveTestData` semantics (`fills` map populated only for non-empty provided entries).
  - [x] `backend/src/crawler/observe.ts`: filled-submit path confirmed read-only (only fills fields present in `resolvedData.fills`; never invents).
  - [x] `backend/scratch/testPredeploy.ts`: P3–P6 patterns reviewed.
- [ ] **W1: Deterministic guard in `backend/src/agent/steps/planner.ts`**
  - [ ] Implement exported pure function `enforceUnprovidedPasswordGuard(plan: TestPlan, unprovidedPasswordIds: ReadonlySet<string>): TestPlan`.
  - [ ] Semantics: empty set returns plan; drop case if ANY step has action 'fill' | 'select', elementId in set, and value !== null/undefined/''; keep empty fills / omitted fills / asserts; capAndRenumberTestPlan; warn log one [Planner] line summary with count + titles.
  - [ ] Compute `unprovidedPasswordIds`: `appMap.elements` where `(e.inputType ?? '').toLowerCase() === 'password' && !(resolvedData?.fills.has(e.id))`.
  - [ ] Wire in `finalizePlan`: after `enforceTestData` and before intent stripping / zero-plan guard.
- [ ] **W2: Prompt instruction**
  - [ ] `backend/src/agent/prompts/plannerPrompt.ts`: Add rule 16 under STRICT RULES for PASSWORD FIELDS.
  - [ ] `backend/src/agent/steps/planner.ts`: Append `PASSWORD FIELDS WITHOUT PROVIDED VALUES: ...` block to `userPrompt` when set is non-empty (matching focus label resolution).
  - [ ] `backend/src/agent/steps/planner.ts`: Condition `promptB` negative wrong-credential instruction on test data being provided.
- [ ] **W3: Regression tests in `backend/scratch/testPredeploy.ts`**
  - [ ] P7: Case filling unprovided password with literal dropped; sibling survives and renumbers to tc-1.
  - [ ] P8: Case with `fill ''` on unprovided password kept.
  - [ ] P9: Case omitting fill (assert/submit/assert_url) on unprovided password kept.
  - [ ] P10: Provided password unaffected (negative wrong-literal and positive secret placeholder survive).
  - [ ] P11: Plan where every case fills unprovided password returns 0 cases from guard (triggers zero-plan guard in finalizePlan).
  - [ ] Confirm P1–P6 pass unchanged.
- [ ] **W4: README update**
  - [ ] Add sentence to test-data behavior description in `Readme.md` (no line numbers, no changes to Measured Results).
- [ ] **W5: Verification**
  - [ ] `pnpm run typecheck`
  - [ ] `pnpm exec tsx scratch/testPredeploy.ts`
  - [ ] `pnpm exec tsx scratch/testPhase12.ts`
  - [ ] `pnpm exec tsx scratch/testPhase12Legacy.ts`
  - [ ] `pnpm exec tsx scratch/testQF2.ts`
  - [ ] `pnpm exec tsx scratch/testPhase9A1.ts`
  - [ ] `pnpm exec tsx scratch/testFallbackChains.ts`
  - [ ] `git diff --check`, `git diff --stat`, `git status --short --branch`, confirm zero frontend files.

---

## Files Touched
- `PREDEPLOY_PATCH_TODO.md` (new)
- `backend/src/agent/steps/planner.ts` (pending W1, W2)
- `backend/src/agent/prompts/plannerPrompt.ts` (pending W2)
- `backend/scratch/testPredeploy.ts` (pending W3)
- `Readme.md` (pending W4)

---

## Verification Log
- **W0 Findings**:
  - `backend/src/agent/testData.ts`: `resolveTestData` iterates over entries, skipping any entry where `!entry.value || entry.value.trim().length === 0` or where `resolveElementRef` returns undefined. Thus, an element is provided if and only if `resolvedData.fills.has(elementId)`.
  - `backend/src/crawler/observe.ts`: `canFill = formFields.length > 0 && formFields.every((f) => resolvedData.fills.has(f.id))`. If any visible input/textarea/select lacks an entry in `resolvedData.fills`, filled submit is skipped entirely. When executed, values are strictly retrieved from `resolvedData.fills.get(f.id)!` (and resolved against `resolvedData.secrets` if secret placeholder). No invented values are generated or typed in `observe.ts`.
  - `backend/src/agent/steps/planner.ts`: `finalizePlan` executes on all plan paths (dual-call, single-call, repair, expansion, salvage). `enforceTestData` currently filters secret assertions and replaces non-negative fills or non-empty negative fills. The zero-plan guard throws `LlmError('BAD_RESPONSE')` immediately following intent stripping.
