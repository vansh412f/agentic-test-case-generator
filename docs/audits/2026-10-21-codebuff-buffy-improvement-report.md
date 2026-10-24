# Improvement Report — 2026-10-21 — Auditor: codebuff-buffy

## Audit Stamp

- **HEAD:** `302006a232b778c28bb8e40e6d0715fc8c66a396` (2026-10-21 15:41:37 +0530), branch `main`
- **Dirty files at start:** none; final tree adds only the two `docs/audits/*-codebuff-buffy-*.md` report files (nothing staged/committed)
- **Terminal available:** Y
- **Checks run:** backend `tsc --noEmit` PASS · frontend `tsc --noEmit` PASS · `next lint` PASS (1 exhaustive-deps warning, `pages/index.tsx:318`) · `pnpm audit` 1 high (`deepmerge-ts` via prisma CLI path) · 7 mandated scratches all PASS · `prisma migrate status` up to date. Same evidence base as the companion bug report (BUG IDs cross-referenced below).

## Prioritised Roadmap

| ID | Title | Section | Impact | Effort | Risk | Deploy tag | Depends on |
|---|---|---|---|---|---|---|---|
| IMP-01 | Close the IDOR: visitor-guard the 5 job-read routes | D | High | S | Low | DEPLOY-BLOCKER | — (BUG-01) |
| IMP-02 | Never bind valid test data into negative/"must fail" cases | B | High | M | Medium | PRE-DEPLOY | — |
| IMP-03 | Compile-time grounding pre-screen: drop/demote success assertions that contradict observations | B | High | M | Medium | PRE-DEPLOY | IMP-02 (shared matcher) |
| IMP-04 | Planner prompt rules: no unobserved post-submit state asserts, no outbound-link padding | B | Medium | S | Low | PRE-DEPLOY | — |
| IMP-05 | Navigation-aware correction prompt (finalUrl + current-page element facts) | B | Medium | M | Low | POST-DEPLOY | — |
| IMP-06 | Shrink `PLANNER_SYSTEM_PROMPT` (6,146 chars ≈ 1.8k tokens/side) + assert-value dedupe | C | Medium | S | Low | PRE-DEPLOY | re-measure w/ measure.ts |
| IMP-07 | Zero-plan fail-fast guard + contract test | A | Medium | S | Low | PRE-DEPLOY | — (BUG-02) |
| IMP-08 | TRUST_PROXY_HOPS calibration step in deploy runbook | D | Medium | S | Low | DEPLOY-BLOCKER | live deploy (BUG-03) |
| IMP-09 | Stale non-terminal job sweeper on the daily retention timer | A | Medium | M | Low | PRE-DEPLOY | — (BUG-05) |
| IMP-10 | Waiting-cap enforcement inside `runQueue.enqueue` | A | Low | S | Low | POST-DEPLOY | — (BUG-08) |
| IMP-11 | Fix the `count`-observation dead path (ground `assert_count` by container CSS) | B | Low | S | Low | POST-DEPLOY | — |
| IMP-12 | Fix 503-vs-wake misclassification in the crawl error UX | E | Medium | S | Low | PRE-DEPLOY | — (BUG-04) |
| IMP-13 | Batch the per-test `updateJobStatus('generating')` writes in the generation loop | C | Low | S | Low | POST-DEPLOY | — |
| IMP-14 | Docs/deploy-drift fixes (env vars, README refs, license badge, pnpm pin) | F | Low | S | Low | PRE-DEPLOY | — |
| IMP-15 | Remove dead code (`crawlGate`/`pipelineGate`) | F | Low | S | Low | POST-DEPLOY | — |
| IMP-16 | Prompt truncation contracts (structured thinning instead of `.slice`) | A | Low | S | Low | POST-DEPLOY | — (BUG-07/BUG-10) |
| IMP-17 | Dependency + harness hygiene (prisma bump for deepmerge-ts, `planCacheHit` field, visitor exp) | F | Low | M | Medium | POST-DEPLOY | IMP-11/IMP-02 for re-measure |

## Top 10 Quick Wins (S-effort, ordered)

1. IMP-01 — add `assertJobOwner` to the five read routes; closes the pre-deploy breach risk.
2. IMP-12 — code-first checks for `BROWSER_LAUNCH_FAILED` in both `pages/index.tsx` catch blocks.
3. IMP-06 — replace 60% of `PLANNER_SYSTEM_PROMPT` with fixture/result-schema shorthand (σ −0.9k tokens/side; verify via measure.ts).
4. IMP-07 — one `if (plan.testCases.length === 0)` throw in `finalizePlan` after `enforceTestData` + testPhase12-style fake-call test.
5. IMP-08 — add "verify `clientIp` ≠ edge IP via `/api/admin/whoami`" as a render.yaml deploy checklist item.
6. IMP-16 — replace `JSON.stringify(...).slice(0, N)` at planner.ts:38-40 and pipeline.ts:469-471 with structured thinning.
7. IMP-11 — connect `assert_count` grounding to `containerCss` (`compiler.ts:225-247`) instead of `ariaRole`-first lookup (`observe.ts:166-172`).
8. IMP-13 — hoist `updateJobStatus('generating')` out of the per-test loop (`pipeline.ts:286-289`).
9. IMP-15 — delete unused `crawlGate`/`pipelineGate` exports (`security/concurrencyGate.ts:32-33`).
10. IMP-10 — refuse `enqueue` at `maxWaiting` and map to the existing `QUEUE_FULL` 429.

## A. Correctness & Reliability

### IMP-07 — Zero-plan fail-fast guard + contract test
- **Current state:** `finalizePlan` returns a plan with `testCases.length === 0` after `enforceTestData` (planner.ts:354-401, 178-207); pipeline completes with baselines only (pipeline.ts:232-241). The dual-call empty-guard (`:453-465`) does not cover post-enforcement emptying (BUG-02).
- **Proposal:** after `enforceTestData`, if the plan is empty and test data was supplied, throw `LlmError('BAD_RESPONSE', …)` so the job fails loudly instead of "succeeding" with only smoke tests.
- **Expected benefit:** eliminates the second silent zero-output path to the measured Run-4 class of failure (which poisons user trust and wastes quota).
- **Effort:** S. **Risk:** Low.
- **How to verify:** new scratch case with `callLlmImpl` fake returning all-secret-assert cases; assert BAD_RESPONSE; re-run `testPhase12`/`testPhase12Legacy` unchanged PASS.

### IMP-09 — Stale non-terminal job sweeper
- **Current state:** critical `safeWrite` fails silently after 3 retries (`db/safeWrite.ts:60-83`); no runtime reconciler exists except boot-time `reconcileOrphanedJobs` (`index.ts:220`); retention deletes but never terminalizes (BUG-05).
- **Proposal:** run `failNonTerminalJobs({ createdBefore: now-1h }, 'SERVER_TIMEOUT', …)` from the existing daily retention timer (`index.ts:226-235`).
- **Expected benefit:** phantom jobs stop draining daily quotas forever; bounded cost = 1 query/day.
- **Effort:** M. **Risk:** Low (1h age bound keeps live jobs safe).
- **How to verify:** scratch: seed a 2h-old non-terminal row → sweeper → `failed`/`SERVER_TIMEOUT`; fresh row untouched; re-run `testPhase12` PASS.

### IMP-10 — Enqueue-time backpressure
- **Current state:** `enqueue` pushes to `waitingGroups` unconditionally (`runQueue.ts:96-110`); cap checked only at admission (`routes.ts:355-363`) — TOCTOU beyond `QUEUE_MAX_WAITING_GROUPS=5` (BUG-08).
- **Proposal:** refuse at `enqueue` when `waitingGroups.length >= maxWaiting`, map to existing `QUEUE_FULL` 429.
- **Expected benefit:** hard invariant instead of a races-at-the-edge soft cap.
- **Effort:** S. **Risk:** Low. **Verify:** queue-unit test, 7 enqueues → 5 accepted/2 rejected.

### IMP-16 — Structured prompt budgeting
- **Current state:** `serializeObservations` (`planner.ts:38-40`) and the corrector feed (`pipeline.ts:469-471`) both emit `.slice`d JSON (BUG-07/BUG-10).
- **Proposal:** pop-thin observations to a `JSON.parse`-valid array; corrector gets `kind | elementId | finalUrl | firstText` lines.
- **Expected benefit:** restores grounding into the 30%-success correction loop; a measurable *correction-attempt success* and tokens `correct` move in scratch/measure.ts re-runs.
- **Effort:** S. **Risk:** Low. **Verify:** unit JSON-parse contract + the-internet slice re-measure.

## B. Generation Quality
(Each item names the metric it should move, measured against the existing `backend/scratch/measure.ts` 12-run matrix; baseline = measurement doc §2–§3: pass 79.3%, findings 9 (100% test bugs), heals 3/10, fresh tokens median 10,213.)

### IMP-02 — Never bind valid test data into negative/"must fail" cases
- **Current state:** `enforceTestData` (planner.ts:178-207) overwrites `fill`/`select` values on **every** case including `category: 'negative'`; the measurement attributes 5 of 10 false expectations to this (§4.5 findings 5–9; §5 rank 1) and the baseline measurement ranked it the #1 problem (2026-10-measurement.md §7 rank 1).
- **Proposal:** in `enforceTestData`, skip filling (or substitute obviously-invalid values like `"__AGT_INVALID__"`, no secrets) for cases where `tc.category === 'negative'` or the title matches `/empty|invalid|must fail|incorrect|fails/i`; additionally remove secret placeholders even from *fill* steps of negative cases, not just asserts. Mirror the rule in `plannerPrompt.ts` so the model plans negatives that don't depend on valid credentials.
- **Expected benefit:** direct move of the headline **false-finding rate 100% → ≤50%** (the 5 credential-injection findings alone) and pass rate toward 85%; no valid-secret execution risk change (fewer secret injections, not more).
- **Effort:** M. **Risk:** Medium (needs re-measure to confirm negatives still detect *real* validation behavior).
- **How to verify:** re-run the 12-run matrix with the same sites/test data; metrics: `finding` count and §4.5-style per-finding classification; target: 0 credential-injection false findings; also audit (c)/(d) counts from §3.2.

### IMP-03 — Compile-time grounding pre-screen for success assertions
- **Current state:** `compileTest` coerces any `assert_*` (compiler.ts:108-213) without cross-checking observations. Grounding audit (a): 5 success assertions had no `form_filled_submit` observation (§4.4a) → 4 of the 9 false findings are unobserved post-submit state asserts (§5 rank 2).
- **Proposal:** in `compileTest` (which already receives `observations`), downgrade any `assert_url`/`assert_visible`/`assert_value`/`assert_hidden` outcome to a "soft" assertion (drop the assert step) **when the observation set contains no matching `finalUrl`/text fact** for post-submit steps; keep a compile-time note so the test's confidence score reflects it (`confidence.ts` already accepts factors).
- **Expected benefit:** targets the remaining 4 false findings + several "weak" positives; false-finding rate → <50% combined with IMP-02; pass rate up with no assertion weakening (ungrounded asserts removed rather than kept and failed).
- **Effort:** M. **Risk:** Medium (needs the same measurement re-run; guard must not strip grounded asserts — decision 1's grounding rule stays "observation-or-App-Map href", same threshold used by `assert_count`).
- **How to verify:** measure.ts matrix plus the §4.4 grounding audit procedure; metric: `finding` count, audit (a) count → 0.

### IMP-04 — Planner prompt hard rules (cheap, prompt-only)
- **Current state:** `plannerPrompt.ts` allows navigation-only/external-link padding (baseline measurement §7 rank 5: TodoMVC spent 3/5 AI cases on outbound links; `filterNavigationOnlyTests` at planner.ts:104-133 now caps it to 1 case but still wastes a case, and cross-origin negative paths still appear).
- **Proposal:** add three one-line rules to the system prompt: (1) never plan a test whose only subject is an outbound/third-party link; (2) a "must fail" case must never depend on the supplied TEST DATA values; (3) never assert an element state (value/hidden/visible) that no OBSERVED FACT demonstrates. Zero code risk, pure prompt text.
- **Expected benefit:** fewer wasted cases → more meaningful assertions within the `MAX_AI_TEST_CASES=8` cap; supports IMP-02/IMP-03; should lower per-run findings without changing rates.
- **Effort:** S. **Risk:** Low. **Verify:** same matrix; tracking: AI-case category distribution and `finding`.

### IMP-05 — Navigation-aware correction prompt
- **Current state:** `correctTest` receives `failureContext` (`steps/corrector.ts:24-40`; `rounds.ts` passes `finalUrl`/`navigations`) — but the prompt text does not instruct the model to *re-ground on the current page* when the page moved; heal attempts spin on vanished selectors (baseline measurement §6-4 "pure spin" cases; current rate 30%).
- **Proposal:** extend `buildCorrectorUserPrompt` (prompts/correctorPrompt.ts) with an explicit block when `failureContext.finalUrl ≠ startUrl`: "The page navigated to X after step N; do not reference elements from the start page — either navigate back or re-target the current page" + reuse IMP-16's compact current-page fact list (App Map elements are already in `elementsInScope`).
- **Expected benefit:** correction success 30% → 50%+ and less token burn on spin rounds (measured `correct` = 25.9% of tokens with 70% failures).
- **Effort:** M. **Risk:** Low. **Verify:** the-internet + saucedemo run slices before/after: `healed`, `correctionsAttempted`, `correct` tokens.

### IMP-11 — Fix the `count`-observation dead path
- **Current state:** `observe.ts:166-172` maps each count container to `appMap.elements.find(e => e.ariaRole === cr.role)` — the *first* element with that role, not the container — so `assert_count` grounding in the compiler (`compiler.ts:225-247`, only used when `countObs.elementId` or a role/container CSS matches) picks either a wrong element or none. Measured: **0 count observations in all 12 runs** (§3.2) and grounding audit (c) counts 1 ungrounded `assert_count` (§4.4c). The dead path wastes the only mechanism that grounds `assert_count`.
- **Proposal:** emit `count` observations keyed by `containerCss` (already computed in the browser pass) plus matching `elementId` found by container ancestry; have the compiler prefer `containerCss` matching.
- **Expected benefit:** `assert_count` cases become grounded (target: audit (c) → 0); `count` observations should appear on list-heavy targets in re-measurement.
- **Effort:** S. **Risk:** Low. **Verify:** unit: builder produces `elementId` for a `ul>li×4` map; re-measure runs gain ≥1 `count` observation on TodoMVC.

## C. Performance & Cost
(Start points are measured or code-derived numbers — no guessing.)

### IMP-06 — Shrink `PLANNER_SYSTEM_PROMPT`
- **Current state:** the system prompt is 6,146 chars ≈ **1,756 tokens** (measured by char count at HEAD), re-sent by *both* dual-call sides plus any repair/expansion call (planner.ts:378-409, 457-467) — with measured 3.4 LLM calls/run, the fixed floor is ~3.5k prompt tokens per fresh run against a median fresh total of **10,213** (measurement §2/§3.1).
- **Proposal:** cut the prose by ~60% (keep the JSON output contract verbatim — it is load-bearing for `validateAndNormalizePlan`); convert narration into a values table. Verify `est` math in `client.ts:157` still reflects real usage via the step records.
- **Expected benefit:** −~3k tokens/run fixed-cost cut on dual-call (measured scale: 115,344 tokens across 12 runs → ~25–30% reduction), plus a lower `est` making the 7,500 TPM skip (`client.ts:158-166`) fire less often on Groq (fewer forced gemini fallbacks than the measured Run 6 skip).
- **Effort:** S. **Risk:** Low. **Verify:** full `MEASURE=1` matrix re-run; metric: median fresh tokens target ≤7,500, calls/run unchanged, schema-validation failure rate not increased.

### IMP-13 — Hoist the per-test status writes
- **Current state:** inside the compile loop, `updateJobStatus(jobId,'generating')` runs once **per test case** (`pipeline.ts:286-289`) — 8 redundant writeMany calls per run on top of `setTestPlan` (which already sets `status: 'generating'`, `db/jobs.ts:81-84`).
- **Proposal:** call it once before the loop (or drop it; `setTestPlan` already flips the status).
- **Expected benefit:** saves ~7 PgBouncer round-trips per run (measured connection_limit=1, so each write serializes the pool); negligible wall-time but reduces pool pressure during bursts.
- **Effort:** S. **Risk:** Low. **Verify:** `testPhase12` legacy PASS + agentStep/status parity check in testPersistence.

## D. Security Hardening

### IMP-01 — Owner-guard the read routes (closes BUG-01)
- **Current state / proposal / verification:** see BUG-01 details; S effort, additive guard, plus a two-visitor scratch test. This is the only DEPLOY-BLOCKER surfaced by this audit.

### IMP-08 — TRUST_PROXY_HOPS calibration runbook item
- **Current state:** render.yaml ships `TRUST_PROXY_HOPS=1` while `index.ts:84-86` expects 2 for the Vercel-rewrite chain (BUG-03); DEPLOY.md §5 has the verification curl but no instruction to act on its result.
- **Proposal:** add to DEPLOY.md §5: "If `whoami.clientIp` equals the edge IP, set `TRUST_PROXY_HOPS=2` on Render and redeploy"; also consider making the middleware-injected header (`frontend/middleware.ts:28-30`) the authoritative source (it already short-circuits via `EDGE_SHARED_SECRET`).
- **Expected benefit:** per-IP quotas attribute to real users; prevents day-one IP-scope exhaustion.
- **Effort:** S. **Risk:** Low. **Verify:** the §5 whoami output plus two distinct-source-IP ipHash comparos on Job rows.

### IMP-17 — Dependency + harness + token-expiry hygiene
- **Current state:** `pnpm audit` = 1 high (`deepmerge-ts <8.0.0`, dev/CLI path — no runtime exposure found, still worth closing); the only `as any` in production is the `buildJobDetail(job as any)` type clash at `jobsRoutes.ts:100`; `measure.ts`'s `planCacheHit` flag is unreliable (measurement §3.1 caveat); visitor tokens lack expiry (BUG-11).
- **Proposal:** bump prisma to a build carrying `@prisma/config`→`deepmerge-ts ≥8.0.0` and re-run `pnpm audit` (free-tier compatible, no paid service involved); fix the `buildJobDetail` typing instead of the cast; set `planCacheHit` from phase latency (`planMs === 0`) as the harness already implies; sequence the visitor-expiry migration as a POST-DEPLOY item after IMP-01.
- **Expected benefit:** audit-clean supply chain + trustworthy measurement fields for the IMP-02/03/05/06 re-measurements.
- **Effort:** M. **Risk:** Medium (prisma minor bump affects lockfile; visitor expiry needs dual-mode parsing).

## E. UX & Product Polish
(Bug-id cross-ref instead of repetition: BUG-04 is the UX-level crawl failure misdiagnosis — fix in IMP-12 / see BUG-04 for the exact screens.)

### IMP-12 — Correct the crawl error classification in the UI
- **Current state / proposal / verification:** see BUG-04. One extra polish: when the wake cycle exhausts, offer a "Retry crawl" action that calls the *same* URL with `fresh` (the backend route already distinguishes wake detection; no new endpoint needed).

## F. Developer Experience & Maintainability

### IMP-14 — Docs & deploy-config drift fixes
- **Current state (verified at HEAD):**
  - `RETENTION_DAYS` and `SAMPLE_JOB_IDS` are read directly from `process.env` (`maintenance/expireOldJobs.ts:10,13`) but appear in **none** of `config.ts`, `backend/.env.example`, or the README config table — undocumented knobs on a path that only runs in production.
  - README API Reference cites `backend/src/api/jobsRoutes.ts:208` for the export endpoint; it is at `:311`.
  - README header badge says "License: not yet specified"; footer says MIT.
  - `docs/measurements/2026-10-phase12-measurement.md` §7 claims `measure_results.json` is not git-ignored; `.gitignore:60` now ignores it (verified with `git check-ignore -v`).
  - Dockerfile pins `corepack pnpm@10` while the repo is documented as pnpm 12.8.1 with a lockfileVersion 9.0 lockfile — works today, but there is no `packageManager` field to keep the two in sync for future lockfile edits (flag at docs level only; the locked free-tier stack is untouched).
- **Proposal:** document the two retention vars in `.env.example`+README (defaults shown), fix the line citation and license badge, add a one-line "(now ignored)" correction to the measurement §7 appendix rather than rewriting history, and add `packageManager: "pnpm@12.8.1"` (or downgrade the Dockerfile pin) — one source of truth.
- **Effort:** S. **Risk:** Low. **Verify:** doc review; `pnpm install --frozen-lockfile` in both Docker stages still succeeds on the next build.

### IMP-15 — Dead code removal
- **Current state (verified at HEAD):** `security/concurrencyGate.ts:32-33` exports `pipelineGate` and `crawlGate`; no source file imports them (grep-verified; only comments reference them). Everything else greps dead-code-clean.
- **Proposal:** remove both exports (or wire `crawlGate` into `/api/crawl` if the intent was a second layer under `crawlSemaphore`).
- **Effort:** S. **Risk:** Low. **Verify:** full grep + backend tsc PASS.

## Deliberately NOT Recommended
(Rejected per locked CONSTRAINTS or evidence — one line each.)

- Redis/BullMQ/external queue behind the run queue: in-process queue is an explicit Architecture Decision 8; bugonly backpressure fixes (IMP-10) suffice at 40 runs/day.
- Next App Router/RSC, tRPC, Zustand, GraphQL: locked out, and `next lint`/tsc show no pressure requiring them.
- WebSockets for job streams: SSE already degrades to polling (`useJobStream.ts`) and constraint forbids.
- RAG/vector DB of historical app maps: measurements show DOM-fresh generation works; grounding gaps are prompt/compile fixes, not retrieval.
- Re-testing the 12-run matrix inside this audit: analysis-only scope; `MEASURE=1` re-runs are the verification step *after* IMP-02/03/06.
- Rate-limit via an edge service (WAF/Cloudflare paid): free-tier constraint; PoW + per-IP daily limits stand.
- Renaming `LOCAL_AGENT_MODE` semantics or dropping BYOK sessionStorage: matches product rules as implemented (`lib/api.ts:112-140`).
- Headless-only guarantee: already enforced twice (config guard `config.ts:150-153`; `HEADLESS` is filtered explicitly into the child env).
