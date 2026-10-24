# Bug Report — 2026-10-21 — Auditor: codebuff-buffy

## Audit Stamp

- **HEAD:** `302006a232b778c28bb8e40e6d0715fc8c66a396` (2026-10-21 15:41:37 +0530), branch `main`
- **Dirty files at start:** none (`git status --short` empty)
- **Terminal available:** Y (bash via tool harness; PowerShell not required)
- **Checks run (verbatim result):**
  - `backend` `pnpm exec tsc --noEmit` — PASS (exit 0)
  - `frontend` `npx tsc --noEmit` — PASS (exit 0)
  - `frontend` `npx next lint` — PASS with 1 warning: `pages/index.tsx:318 react-hooks/exhaustive-deps (missing 'handleCrawl')`, exit 0
  - `backend` `pnpm audit` — exit 0, **1 high**: `deepmerge-ts <8.0.0` (GHSA-ggr8-5vv4-36mx) via `.>@prisma/client>prisma>@prisma/config>deepmerge-ts` and `.>prisma>@prisma/config>deepmerge-ts` (Prisma CLI/dev path; not a runtime dependency of the API server)
  - Scratches from `backend/` — all PASS (exit 0): `testQF2` (10/10 groups), `testPhase12` (P4,P5,P6,P8,P9,P10 + P7 live skipped), `testPhase12Legacy` (14/14), `testPhase9A1`, `testTrace` (T1–T4, T6 live skipped), `testAssertionGuard`, `testQuickFixes`
  - Bonus: `backend` `pnpm exec prisma migrate status` — "Database schema is up to date!" (6 migrations)
- **Not run:** live 12-run pipeline matrix (`MEASURE=1`), Docker image build, Vercel/Render live behavior — out of scope for an analysis-only audit; folded into Could-Not-Verify items.

## Summary

| Severity | CONFIRMED | SUSPECTED | Total |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 5 | 0 | 5 |
| Low | 2 | 4 | 6 |
| **Total** | **7** | **4** | **11** |

- **DEPLOY-BLOCKERs: 1** (BUG-01). PRE-DEPLOY: 3 (BUG-02, BUG-03, BUG-05). POST-DEPLOY: 7.
- No Critical/High finding survived scrutiny: every Method-1 check passes and all security-critical paths read clean (see Checked and Clean). The one deployment-qualifying breach risk is the authorization gap in BUG-01.

## Bug Table

| ID | Severity | Area | Confidence | Deploy tag | Title |
|---|---|---|---|---|---|
| BUG-01 | Medium | C – API/security | CONFIRMED (READ) | **DEPLOY-BLOCKER** | No visitor ownership check on 5 job-read routes (IDOR) |
| BUG-02 | Medium | A – Pipeline | SUSPECTED | PRE-DEPLOY | `enforceTestData` can silently emit 0 AI cases; job "completes" with baseline only |
| BUG-03 | Medium | D/G – Deploy config | SUSPECTED | PRE-DEPLOY | `TRUST_PROXY_HOPS=1` (render.yaml) contradicts the in-code 2-hop Vercel-rewrite expectation → shared IP bucket breaks per-IP quota |
| BUG-04 | Medium | F – Frontend | CONFIRMED (READ) | PRE-DEPLOY | Browser-launch failures (503) are misrouted into the "target waking" retry loop |
| BUG-05 | Medium | A – Pipeline · G | SUSPECTED | PRE-DEPLOY | Critical persistence failure after retries leaves a job permanently non-terminal until reboot |
| BUG-06 | Low | A/E – Planner | CONFIRMED (READ) | POST-DEPLOY | Uncaught `TypeError` in `validateAndNormalizePlan` for malformed leading navigate value |
| BUG-07 | Low | E – Planner prompts | CONFIRMED (READ) | POST-DEPLOY | `serializeObservations` can append truncated, invalid JSON to the planner prompt |
| BUG-08 | Low | A – Queue | CONFIRMED (READ) | POST-DEPLOY | `runQueue.enqueue` ignores `QUEUE_MAX_WAITING_GROUPS` under concurrent submissions |
| BUG-09 | Low | F – Frontend | SUSPECTED | POST-DEPLOY | `ActiveJobsDock` poll effect restarts on every state change (poll churn on completion) |
| BUG-10 | Low | A – Corrector | CONFIRMED (READ) | POST-DEPLOY | Corrector prompt receives observations hard-sliced mid-JSON at 2000 chars |
| BUG-11 | Low | C – Security | SUSPECTED | POST-DEPLOY | Visitor tokens never expire server-side; a leaked token is a permanent identity |

## Bug Details

### BUG-01 — No visitor ownership check on 5 job-read routes (IDOR)

- **Evidence** (READ, jobsRoutes.ts at HEAD `302006a`):
  - `GET /api/jobs/:id` (`jobsRoutes.ts:81`) → `getJobDetailView(id)` — `db/jobs.ts:118-125` queries `where: { id }` with **no** visitor filter; `jobDetail.ts:46-53` derives `canCancel`/`canEdit` per viewer but never denies access.
  - `GET /:id/appmap` (`jobsRoutes.ts:108`) — `prisma.job.findUnique` at `:115-119` selects `visitorId: true` but never compares it to `req.visitorId`.
  - `GET /:id/stream` (`jobsRoutes.ts:282` → `api/jobStream.ts:20-27`) — live SSE of any job by id; no owner gate before header writing.
  - `GET /:id/report.html` (`jobsRoutes.ts:291`) and `GET /:id/export.zip` (`jobsRoutes.ts:311`) → `getJobById(id)` — `db/jobs.ts:99-107`, no visitor filter; row includes `finalCode` of every test.
  - Contrast: `cancel` (`jobsRoutes.ts:139-152`), `rerun`/`trace` (`testRerun.ts:187-193`, `jobsRoutes.ts:255-258`) and `GET /api/jobs` list (`db/jobs.ts:170`) all enforce ownership. `visitorMiddleware` only mints/parses identity; it never authorizes.
- **Trigger:** any visitor calls these five routes with a job UUID they did not create (UUID obtained via leak: shared link, proxy/browser history, export filename `tests-<jobId>.zip`).
- **Impact:** disclosure of another visitor's target URL, crawled App Map, generated test code, live SSE progress and full attempt history. Gated by possession of an unguessable UUID → Medium, not High — but it contradicts the product's owner-only model (the trace viewer is explicitly owner-gated) and is the cheapest fix among pre-deploy items.
- **Root cause:** authorization was added to mutation-style routes only; read-detail routes kept raw id-based lookups.
- **Minimal fix sketch:** add `assertJobOwner(job, req)` (throw `JobError('JOB_NOT_FOUND')` unless `job.visitorId === req.visitorId`, with the same `visitorId === null && LOCAL_AGENT_MODE` carve-out the rerun route uses) and apply it to the five routes; or push `where: { id, visitorId: req.visitorId }` into `getJobById`/`getJobDetailView`.
- **Effort:** S. **Regression risk:** low (additive guard; local-agent jobs always carry the minted visitorId).
- **How to test the fix:** scratch in the `testPhase9A.ts` header-driven style: mint two visitor tokens A/B, `createPendingJobs` owned by A, then assert B receives 404 on `/api/jobs/:id`, `/:id/appmap`, `/:id/stream`, `/:id/report.html`, `/:id/export.zip` while A receives 200.

### BUG-02 — `enforceTestData` can silently emit 0 AI cases; job completes with baseline only

- **Evidence** (READ): `backend/src/agent/steps/planner.ts:178-207`. `enforceTestData` drops assert steps whose `value` contains a `__AGT_SECRET_n__` token (`:186-193`), then keeps only cases with ≥1 remaining `assert_*` step (`keptCases.push` at `:198`, `plan.testCases = keptCases` at `:201`). `finalizePlan` (planner.ts:354-401) calls it and returns the plan **without any empty-result check**. `pipeline.ts:232-241` then appends only baseline tests and proceeds to `completeJob`. The dual-call "no valid test cases" guard (`planner.ts:453-465`) fires only for the dual path *before* enforcement.
- **Trigger** (hypothesis): test data is supplied and the plan's cases all end in assertions on placeholder values — every case loses its assertion steps and is dropped. Reachable in principle from the LLM output-space; not observed in the 12 measurement runs.
- **Impact:** user supplies login data and receives a `completed` job with only `smoke-1`/`smoke-2` — a *second, silent* path to the measured Run-4 outcome (measurement §4.2: "job `failed` … 0 tests"). Here the job doesn't even fail, so the user gets no error and wasted quota. Trust damage to the core flow.
- **Root cause:** empty-plan handling exists for schema-failure paths but not for post-enforcement emptying of a syntactically valid plan; no scratch exercises `enforceTestData` emptying the whole plan (testPhase12Legacy groups 8–10 cover caps and normal fills only).
- **Minimal fix sketch:** in `finalizePlan` after `enforceTestData`, throw `LlmError('BAD_RESPONSE', 'All planned test cases were discarded after binding test data')` when `plan.testCases.length === 0` (mirrors the dual-path failure at `:453-465`).
- **Effort:** S. **Regression risk:** low (fails the job loudly instead of a fake success).
- **How to test the fix:** planner-unit test in the `testPhase12.ts` style with `callLlmImpl` fake (the injection pattern exists at `planner.ts:261`): fake returns 3 cases whose only asserts are `assert_text` on a `__AGT_SECRET_1__` value; supply matching test data; assert `planTests` throws BAD_RESPONSE — never an empty-but-successful plan.

### BUG-03 — `TRUST_PROXY_HOPS=1` vs in-code 2-hop expectation for the Vercel-rewrite chain

- **Evidence** (READ + docs): `render.yaml` presets `TRUST_PROXY_HOPS=1`; `backend/src/index.ts:84-86` comment: "Trust proxy hop count must match the deployed proxy chain (Render alone = 1; Vercel-rewrite -> Render = 2). A wrong value either collapses all users into one IP bucket or trusts spoofable headers." `clientIp()` (`security/clientIp.ts:9-27`) falls back to `req.ip` when the edge header path fails → `ipHashFor` (`security/dailyBudget.ts:33-46`) → `FREE_IP_DAILY_LIMIT=20` counts (`routes.ts:368-407`).
- **Trigger:** first production deploy following `docs/DEPLOY.md` §2–§3 (frontend on Vercel, `/api/*` through the Next rewrite → Render), with render.yaml's preset unchanged.
- **Impact (if the comment's model is right):** every visitor hashes to the Vercel edge IP; after 20 free runs/day in total the IP scope exhausts and **all** free users see `DAILY_QUOTA_EXHAUSTED` (`routes.ts:389-401`) — a de-facto core-flow breaker for typical users. SUSPECTED because the actual header chain must be measured; the repo itself carries the contradicting statements.
- **Root cause:** deploy preset contradicts in-code expectation; DEPLOY.md §5 "IP Calibration Verification" exists but cannot succeed through a wrong hop count (whoami would report the edge IP).
- **Minimal fix sketch:** immediately after (or in a staging preview of) deploy, hit `/api/admin/whoami` with `X-Admin-Secret` and set render.yaml's `TRUST_PROXY_HOPS` to the measured value (likely `2`); alternatively verify that `frontend/middleware.ts:28-30` really injects `x-agt-edge-secret` + `x-agt-client-ip` on the rewrite path, which makes the hop count irrelevant for quota attribution.
- **Effort:** S. **Regression risk:** low; wrong hop count only degrades quota scoping, not function.
- **How to test the fix:** two distinct source IPs through the chain must produce two distinct `ipHash` values on created Job rows (and whoami `clientIp` ≠ the edge IP); one scratch SQL check after two curl submissions.

### BUG-04 — Browser-launch failures misrouted into the "target waking" retry loop (frontend)

- **Evidence** (READ): `frontend/pages/index.tsx:374` — `if (error.code === 'TARGET_WAKING' || error.status === 503)`. `BROWSER_LAUNCH_FAILED` maps to 503 (`backend/src/api/errors.ts:34,52`) so the dedicated `UPSTREAM_UNAVAILABLE`/`BROWSER_LAUNCH_FAILED` branch at `:379-384` is dead for any 503-status error. Same pattern in `retryCrawl` at `:235` (503 → silent wake retry, no toast).
- **Trigger:** Render cold start where Chromium launch fails (`BROWSER_LAUNCH_FAILED`, 503), or any 503-mapped CrawlError while hosted.
- **Impact:** user sees the "Target waking up" countdown banner for up to ~2 minutes (retry cycle, `index.tsx:259-276`) with advice to open the *target* URL in a new tab (`:507-517`) — wrong diagnosis for a server-side browser failure; core flow appears hung, then shows "still asleep", which is also wrong.
- **Root cause:** a status-based fallback (`status === 503`) outranks the specific error codes.
- **Minimal fix sketch:** in both catch blocks, check `error.code === 'BROWSER_LAUNCH_FAILED'` / `'UPSTREAM_UNAVAILABLE'` first; make the wake path `error.code === 'TARGET_WAKING'`-only (drop `err.status === 503`, or accept `SERVICE_UNAVAILABLE` explicitly only where the backend actually distinguishes it).
- **Effort:** S. **Regression risk:** low (`TARGET_WAKING` remains 503 in `CRAWL_ERROR_STATUS`).
- **How to test the fix:** component test with `crawlPage` mocked to reject `new ApiError(503,'BROWSER_LAUNCH_FAILED',…)`: assert no `wakingCrawl` state and the launch-failure message appears.

### BUG-05 — Critical persistence failure leaves a job permanently non-terminal until reboot

- **Evidence** (READ): `pipeline.ts` finalizes via `safeWrite('completeJob'|'failJob', …, { critical: true })` (`pipeline.ts:478-495, 523-541`); `db/safeWrite.ts:60-83` — the critical wrapper retries 3× then returns `undefined` **without throwing**; a lost `completeJob`/`failJob` is only logged. No runtime sweeper exists: `maintenance/reconcileJobs.ts` runs at boot only (`index.ts:220`), `runRetention` deletes >30-day jobs but never terminalizes stuck rows (`expireOldJobs.ts:18-29`), and `jobStream.ts` then answers `unavailable` forever for the non-terminal snapshot. Quota impact: `countJobsForBudget` excludes only cancelled-without-start rows and SERVER_RESTART/SHUTDOWN errors (`dailyBudget.ts:53-69`) — a phantom `executing`/`pending` row keeps consuming the visitor/IP/global daily budget until the next reboot reconciles it.
- **Trigger:** ≥4 consecutive transient DB failures (Supabase pooled `P2024`/`P1001` bursts) exactly during a `completeJob`/`failJob` call. SUSPECTED — path is read-verified; live reproduction needs an induced outage mid-run.
- **Impact:** UI shows a forever-running job; the daily quota quietly drains for that visitor/IP; SSE/polling never converge.
- **Root cause:** fail-safe write semantics with no durable reconciler loop while the process stays alive.
- **Minimal fix sketch:** piggyback the existing daily retention timer (`index.ts:226-235`) with one cheap terminalizer run: `failNonTerminalJobs({ createdBefore: now-1h }, 'SERVER_TIMEOUT', …)` per day (same shape as `expireOldJobs.ts`'s other sweeps; the 1h bound keeps live jobs safe).
- **Effort:** M. **Regression risk:** low.
- **How to test the fix:** scratch: `createPendingJobs` with `startedAt` 2h in the past, run the new sweeper, assert `status='failed'` + errorCode `SERVER_TIMEOUT`; assert a fresh (<1h) non-terminal row is untouched.

### BUG-06 — Uncaught `TypeError` for malformed leading-navigate value in plan normalization

- **Evidence** (READ): `backend/src/agent/steps/planner.ts:85-92` — the leading-navigate strip condition evaluates `new URL(tc.steps[0].value, appMapUrl)` inline with **no try/catch**; a value like `"::"` makes `new URL` throw `TypeError: Invalid URL`. The rewrite loop two lines below (`:95-102`) does wrap its own `new URL` in try/catch — only the first occurrence is unprotected. The throw propagates synchronously out of `validateAndNormalizePlan` inside `extractCases` (`:421-426`) and the single-call path (`:495`) — it is not an `LlmError`, so no self-repair/salvage runs and the job dies as `INTERNAL_ERROR` (`pipeline.ts:71-77, 543-553`).
- **Trigger:** planner, expansion or repair call returns a first step `{"action":"navigate","value":"::"}` (or any string that is both non-absolute and URL-invalid). Rare, but the failure mode wastes the whole run (crawl + observe) on a single malformed field.
- **Impact:** edge-case breakage of the planning phase with a misleading `INTERNAL_ERROR` instead of the designed BAD_RESPONSE/repair flow.
- **Root cause:** unguarded parse in a normalization hot path that guards the same pattern elsewhere in the same function.
- **Minimal fix sketch:** wrap the strip-condition in try/catch (mirror `:95-102`), or pre-test `value` against a URL-ish regex before constructing a URL.
- **Effort:** S. **Regression risk:** none.
- **How to test the fix:** unit test in the `testPhase12.ts` style: `validateAndNormalizePlan('{"testCases":[{"id":"a","title":"t","steps":[{"action":"navigate","elementId":null,"target":null,"value":"::"}]}]}', …)` must return a validates/ok result — not throw TypeError.

### BUG-07 — Truncated invalid JSON from `serializeObservations`

- **Evidence** (READ): `backend/src/agent/steps/planner.ts:29-40` — observations are popped until JSON ≤ 6000 chars; the final fallback `json.slice(0, 6000)` returns a syntactically cut JSON string, embedded verbatim in the planner prompt (`:257-259`).
- **Trigger:** observation-rich targets (the 25-observation cap × texts + `finalUrl`/`title` fields can exceed 6000 chars). Possible on form-heavy pages; not hit in the 12 measured runs (47 observations total).
- **Impact:** the LLM consumes malformed JSON fragments — silently weakens grounding and can push the model toward schema-invalid emits (the measured Run-4 all-sides-validation-failure starts from prompt confusion, measurement §4.2/§5 rank 7). No crash.
- **Root cause:** character-budgeted truncation applied to structured data instead of dropping whole observations.
- **Minimal fix sketch:** only pop whole observations; if a single observation alone exceeds the cap, substitute a slimmed `{kind, finalUrl}` variant; assert `JSON.parse` on the built string in dev/test.
- **Effort:** S. **Regression risk:** none.
- **How to test the fix:** unit: synthesize 30 observations with 500-char texts → returned string must `JSON.parse` cleanly and each included observation must carry all fields.

### BUG-08 — `runQueue.enqueue` ignores the waiting cap under concurrent submissions

- **Evidence** (READ): `backend/src/agent/runQueue.ts:96-110` — `enqueue` pushes to `waitingGroups` unconditionally and publishes positions; no upper bound exists inside the queue. The cap lives only at admission: `runQueue.isFull()` (`runQueue.ts:37-44`) checked in `routes.ts:355-363` — a TOCTOU window: ≥6 concurrent `/api/generate` from distinct clients (claim() only dedupes *same* clients, `runQueue.ts:50-62`) all observe `isFull()==false` and then enqueue into >5 waiting groups.
- **Trigger:** burst of simultaneous submissions from different visitors/IPs (PoW + daily quotas still bound total volume, so escape is bounded).
- **Impact:** fairness/ordering drift and waiting-list growth beyond `QUEUE_MAX_WAITING_GROUPS=5`; growth is bounded by `GENERATE_DAILY_LIMIT=40`/day, hence Low.
- **Root cause:** backpressure enforced at the HTTP layer only, not at enqueue time.
- **Minimal fix sketch:** in `enqueue`, if `this.waitingGroups.length >= this.maxWaiting`, refuse (throw, caught in `routes.ts` and mapped to the existing `QUEUE_FULL` 429; the routes `finally` at `:462-465` already releases the claim token on this path).
- **Effort:** S. **Regression risk:** low.
- **How to test the fix:** queue-unit test: seed `activeGroups=[dummy]` and enqueue 7 groups → 5 accepted (`waitingCount===5`) + 2 rejections of the expected error type.

### BUG-09 — ActiveJobsDock poll effect restarts on every state change

- **Evidence** (READ): `frontend/components/layout/ActiveJobsDock.tsx:104-113` — `useEffect(…, [items, router])` recreates the 4s `setInterval` whenever `items` identity changes; the same effect writes `setJobsState(...)` and completion paths call `untrackJob(entry.id)` (`:96-97`) → `items` changes → full effect teardown/restart mid-cycle, including restarting the in-flight `Promise.all` poll round.
- **Trigger:** any tracked job finishing while several are tracked (the moment the dock is busiest).
- **Impact:** duplicate concurrent fetch bursts (up to tracked-jobs × restarts), extra 404-handling work, and a theoretical double-toast from completion branches firing in overlapping rounds. SUSPECTED — needs a network capture on a real multi-job completion to size.
- **Root cause:** interval lifetime bound to a frequently-changing props identity.
- **Minimal fix sketch:** key the effect on `items.map(i=>i.id).join('|')`, or keep the interval in a ref and read `items` from a `useRef` mirror inside `poll`.
- **Effort:** S. **Regression risk:** low.
- **How to test the fix:** React testing-library render with 2 mocked in-flight + 1 completing job; assert the polling fetch count matches one cycle per tick (no duplicated bursts).

### BUG-10 — Corrector prompt receives observations hard-sliced mid-JSON

- **Evidence** (READ): `backend/src/agent/pipeline.ts:469-471` — `const observationsText = appMap.observations?.length ? JSON.stringify(appMap.observations).slice(0, 2000) : undefined;` fed to `correctTest` → `buildCorrectorUserPrompt({…, observationsText})` (`steps/corrector.ts:24-40`).
- **Trigger:** any target with more than a couple of observations (each observation with `finalUrl`+`title`+texts serializes to ~300–800 chars; larger lists blow 2000 easily).
- **Impact:** the corrector sees a broken-JSON fragment instead of grounded facts. Feeds the measured correction problem directly: correction success is 30% and **all successful heals are strict-mode locator fixes**; correctors burn ~26% of total tokens (measurement §3.1) with no usable grounding left after the slice.
- **Root cause:** string-slice budgeting applied to structured data (same pattern as BUG-07, one layer deeper).
- **Minimal fix sketch:** build a compact line list (`kind | elementId | finalUrl | firstVisibleText`) and cap *that* by chars; never slice a JSON dump.
- **Effort:** S. **Regression risk:** none (prompt content only).
- **How to test the fix:** re-run the the-internet slice of `scratch/measure.ts` before/after; metrics: `correct` tokens per run and heals count (§3.1 methodology).

### BUG-11 — Visitor tokens never expire server-side

- **Evidence** (READ): `backend/src/security/visitor.ts:11-29` — `mintVisitorToken` issues `${visitorId}.${HMAC}` with no `exp`/`iat`; `parseVisitorToken` (`:18-29`) verifies only the split-shape and signature. No server-side TTL anywhere; the README Decision 7 "30-day TTL" is implemented only as client-side localStorage hygiene (`frontend/lib/api.ts:66-79` persists the header value indefinitely).
- **Trigger:** any leak of the `x-visitor-id` value (shared machines, browser history, or any future location the UUID appears — with BUG-01 unfixed, even more surface).
- **Impact:** a leaked visitor token grants permanent access to the victim's `GET /api/jobs` list (final test code) and permanently fixed quota attribution; rotation requires rotating `VISITOR_SIGNING_SECRET`, which DEPLOY.md §7 explicitly says destroys history for everyone.
- **Root cause:** token carries no signed expiry.
- **Minimal fix sketch:** add a signed epoch segment (`visitorId.epoch.sig`, HMAC over both), accept legacy 2-part tokens only until a defined cutover date; purge on failure.
- **Effort:** M. **Regression risk:** medium (must remain parseable across the deploy; needs dual acceptance for one release).
- **How to test the fix:** scratch (testPhase9A pattern): mint → rewrite epoch to 31 days ago → expect `parseVisitorToken` null; epoch within 30 days → returns visitorId.

## Already-Documented Issues (ranked, with pointer to source doc)

1. **False-finding rate 100% of reported findings** — docs/measurements/2026-10-phase12-measurement.md §4.5/§6, README "Known Pipeline Limitations" #1. Drivers per §5 rank 1–2 (valid credentials injected into "must fail" cases; unobserved post-submit state asserts). The product's top quality debt; improvement proposals IMP-02/03/04.
2. **Correction success rate 30%** (3/10; all TodoMVC strict-mode heals; role-locator runs never heal) — measurement §3.1/§5 ranks 3–5, README #2. BUG-10 is a contributing code defect on top of it.
3. **Dual-call planner cost & reliability** (×3.28 fresh tokens, +86% calls, ~11 s observe; Run 4 zero-output) — measurement §3.3/§5 rank 7, README #3. BUG-02 documents a *second, silent* zero-output path; IMP-06 addresses cost.
4. **Plan-cache `measure.ts` marker unreliable** (`plan.planCacheHit` false even on hits) — measurement §3.1 caveat + §7; harness fix in IMP-17.
5. **"`measure_results.json` is NOT git-ignored"** — measurement §7 is now a **stale doc note**: `.gitignore:60` does ignore `backend/scratch/measure_results.json` (verified via `git check-ignore -v`, exit 0). Correction recorded in IMP-14.

## Checked and Clean

- **AST safety gate** (`runner/codeSafety.ts`): allowed-imports and named-import whitelist; rejects eval/Function/process/globalThis/fetch/WebSocket/Reflect/WeakRef/setInterval; forbidden property list (launch/route/addInitScript/saveAs/pdf/…); destructured-fixture-only rule; `file:` URL rejections; element-access restrictions. Matches testPhase9A/9A1 coverage; no bypass found by read.
- **Secret lifecycle:** placeholders substitute to disk only inside `executeTests` (`executor.ts:217-224`, run dir mode 2770 under uid); `redactSecrets` before error surfacing (`executor.ts:161-170, 437-448`); `sanitizeError` strips ANSI + runner paths (`runner/sanitizeError.ts`); `correctionPreservesSecrets` gates corrector output (`pipeline.ts:476-486`); remembered test data persists only client-side (`lib/rememberedTestData.ts`); rerun never persists secrets (transient Map, `testRerun.ts` design note).
- **Trace store:** HMAC over `trace:${traceId}:${entry.visitorId}:${exp}` + `timingSafeEqual` (`traceStore.ts:171-195`); boot clean-slate + 10-min sweep + 1 h TTL; oversize rejection 25 MB (scratch T4); serving only via verified token (`traceRoutes.ts:12-37`); no traversal (fixed `${traceId}.zip` name).
- **Export zip:** filename regex `^[a-zA-Z0-9_-]+\.spec\.ts$` + duplicate check (`projectExporter.ts:67-73`); `.env.example` contains names only; 401/403 counted reachable by design (testPhase12 P6); no path traversal.
- **SSRF/egress:** `netPolicy.ts` blocklist covers IPv4+IPv6 private ranges, loopback, link-local, cloud metadata, CGNAT; `egressProxy.ts` re-resolves at connect time (`:87-160`), 403s private IPs and disallowed ports, IPv4-first failover, 10 MB body cap, 60 s socket timeouts; observe's cross-origin link following rides the same proxy (`pageCrawler.ts:29-50`); `assertPublicTarget` re-checks on admission.
- **PoW/rate limits:** ALTCHA verify with reserve-before-verify replay map (`pow.ts:34-63`); challenges expire after 5 min; admin endpoints use constant-time compare and 404-on-fail (`adminRoutes.ts:13-40`); per-IP limiters wired to `/crawl`, `/pow/challenge`, `/byok/validate`.
- **Queue/concurrency:** claim-token dedupe with 60 s decay (`runQueue.ts:50-62`); settle→pump without lost wakeups; `WaitableSemaphore` bounded waiting with timeout cleanup (`concurrencyGate.ts:35-112`); rerun single-slot server-wide.
- **Cancellation/abort:** every status write uses `updateMany` with `notIn: [completed, failed, cancelled]` (single-flight safe); abort listeners removed in executor (`:313-318`) and validator (`:83-99`); `pdeathsig=KILL` + reaper + isolation lock (`isolation.ts:33-46, 103-123, 126-133`).
- **DB layer:** indexes match query patterns (`Job`: `[createdAt,id]`, `[visitorId,createdAt]`, `[ipHash,createdAt]`, `[runGroupId]`; `GeneratedTest`: `[jobId]` + unique(jobId,testCaseId) + unique(jobId,filename); `ExecutionResult`: unique(generatedTestId,attemptNumber); `ServerEvent`: `[createdAt]`) vs actual queries (`listJobs` grouped aggregates — no N+1, `db/jobs.ts:170-206`; `getJobDetailView` batches attempt-1 codes in one `findMany`, `:138-160`); JSON columns validated through Zod before serving in reports (`htmlReport.ts:23-26`); `prisma migrate status` → up to date.
- **Daily budgets:** admission order (queue-full → quota reserve → PoW) with reservation released after job rows persist (`routes.ts:368-450`) so counts stay truthful; DB-unavailable → 503 + Retry-After, never 429 (`:378-388`).
- **Config/deploy guards:** production fail-fasts for `LOCAL_AGENT_MODE`, `RUNNER_ISOLATION≠uid`, secret minimums (`config.ts:100-150`); child env allowlist strips `DATABASE_URL`/keys (`runner/childEnv.ts` PASSTHROUGH); netGuard attached only when the egress proxy exists (`playwrightRunnerEnv`).
- **Error mapping/HTTP hygiene:** every error class has a status table (`api/errors.ts`); no stack leakage in the production handler (`index.ts:196-210`); nosniff/Referrer-Policy/X-Frame-Options set (`index.ts:71-76`); CORS strict allowlist + optional anchored preview regex.
- **Frontend hygiene:** `as any` count **0** (the only production cast is the typed-clash workaround `jobsRoutes.ts:100`; the rest live in `backend/scratch/`); Monaco lazily imported via `next/dynamic` (`components/code/CodeViewer.tsx:6-8`, `DiffViewer.tsx:4-6`); SSE→polling degradation + terminal-idle logic (`hooks/useJobStream.ts:41-70, 100-110`); abortable local-target probe (`components/home/LocalTargetPanel.tsx:72-82`); BYOK keys sessionStorage-only (`lib/api.ts:112-140`); test-data secrets kept in component state and cleared (`components/job/TestResultCard.tsx:117-119`); a11y dialog/aria-live/labels present throughout; no leaked standalone intervals found in the audited pages (BUG-09 is the sole suspect).

## Could Not Verify

1. **BUG-03 hop-chain reality** — requires a live Vercel+Render deployment and two distinct source IPs (DEPLOY.md §5's whoami step is exactly the missing runtime evidence).
2. **BUG-05 reproduction** — needs an induced multi-P2024 DB outage during a real run; the code path itself is read-verified.
3. **BUG-09 network sizing** — needs a devtools capture on a live multi-job finish.
4. **BUG-02 reachability** — the prompt instructs assertion-bearing cases only with observed form submits (`testData.ts:74-81`), so the all-secret-assert shape has not occurred in the 12 measured runs; the code path itself is read-verified.
5. Docker image build, Render free-tier Chromium launch behavior, Vercel rewrite headers — no Docker/deployment in this analysis-only audit (out of scope per instructions).
