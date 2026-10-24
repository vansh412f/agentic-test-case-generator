# Model Benchmark & Fallback Chains Implementation Todo

Status: COMPLETED (Stages 1, 5, Repo Cleanup, 7, 8, 3, 2, 4 complete; stopped before Stages 9, 6, 10, 11)
CURRENT POINTER: P8 Complete / Work Complete
Base HEAD: 7d4b093
Branch: main

## Prior Verification Closure (Preserved from IMPLEMENTATION_TODO.md)
- S0–S7: Pre-deploy simplification, multi-attempt traces, Replay UI, removal of edit/rerun/Show browser, and conservative test-data fix completed and verified.
- B0–B8 (Blocker patch): Fixed trace viewer redirect loop (`/trace-viewer/index.html?trace=...`), stabilized ReplayPanel link fetching (`requestSeqRef`, `loadedKey`, `visibleLinks`), restricted local-unclaimed trace metadata to `config.LOCAL_AGENT_MODE`, guarded pipeline trace owner lookup, verified static checks.
- B7 Manual Replay Proof in Browser: Verified on fresh job `0fd96609-d82f-4afc-9bab-7b5b9f11a3b2` in continuous browser UI session (Playwright Trace Viewer loaded inside iframe, actions/timeline/DOM snapshot rendered, timeline scrubbing passed, switching to tc-2 passed, Refresh passed, Download link targeted `trace-smoke-1-attempt-1.zip`, Open full screen opened standalone viewer at `/trace-viewer/index.html`, and share view hidden).

---

## P0 — Baseline and Inventory
- [x] P0.1 Record git status/log/diff in this todo.
- [x] P0.2 Verify NVIDIA touchpoints, trace constants, logger hotspots, README sections, and LLM types by grep/read.
- [x] P0.3 Inventory local generated artifacts without deleting yet (`git status --short --ignored`).

## P1 — User Order 1: Remove NVIDIA Completely
- [x] P1.1 Delete `backend/src/llm/providers/nvidia.ts` and remove from provider registry.
- [x] P1.2 Remove `nvidia` from `KNOWN_LLM_PROVIDERS` and all `modelFor`/`reasoningEffort` branches.
- [x] P1.3 Remove `NVIDIA_API_KEY` and `NVIDIA_MODEL` from `backend/src/config.ts`, `backend/.env.example`, `render.yaml`, and validation messages.
- [x] P1.4 Change default `LLM_PROVIDER_ORDER` to `"groq,gemini"`.
- [x] P1.5 Remove NVIDIA from requestKeys typing/logic and persistence default model mapping.
- [x] P1.6 Remove NVIDIA-specific secret masking where it is provider configuration.
- [x] P1.7 Remove current-state NVIDIA statements from `Readme.md`, `docs/DEPLOY.md`, `docs/OPERATIONS.md`.
- [x] P1.8 Verify zero functional NVIDIA references in `backend/src`, `backend/.env.example`, `render.yaml`, `Readme.md`, docs.
- [x] P1.9 Run backend typecheck and focused tests.

## P2 — User Order 5: Trace Retention 200 + FIFO + Byte Ceiling
- [x] P2.1 Implement in `backend/src/runner/traceStore.ts`:
  - `MAX_TRACES = 200`
  - `MAX_TOTAL_TRACE_BYTES = 256 * 1024 * 1024` (256 MiB)
  - `MAX_TRACE_BYTES = 25 * 1024 * 1024` (25 MiB)
  - `TRACE_TTL_MS = 3600000` (1 hour)
  - Oldest-first FIFO eviction by createdAt before new trace addition ensuring total count <= 200 and total bytes + new trace <= 256 MiB.
  - Export pure eviction planning helper for unit testing.
- [x] P2.2 Extend `backend/scratch/testTrace.ts` with T8 testing FIFO/byte eviction planning.
- [x] P2.3 Run `testTrace.ts` (T1–T8 pass).

## P3 — Repo and Local-File Cleanup Before Benchmarking
- [x] P3.1 Tracked deletions:
  - Delete `IMPLEMENTATION_TODO.md` (B7 summary preserved above).
  - Delete `docs/audits/2026-10-21-codebuff-buffy-bug-report.md`.
  - Delete `docs/audits/2026-10-21-codebuff-buffy-improvement-report.md`.
  - Delete `backend/scratch/runTestPredeploy.ts`.
- [x] P3.2 Scratch inventory table classifying files (canonical regression, manual/live harness, archive candidate).
- [x] P3.3 Local generated artifacts cleanup:
  - `backend/logs/*.json` (621 removed -> 0)
  - `backend/playwright-runner/.traces/*.zip` (3 removed -> 0)
  - `backend/playwright-runner/tests/run-*` leftovers (2 `run-*` + 1 `test-run-*` removed -> 0)
  - `backend/playwright-runner/test-results/**` (3 files removed -> deleted directory)
  - `backend/playwright-runner/results.json` (0 -> 0)
  - `backend/scratch/measure_results.json` (1 removed -> deleted)
- [x] P3.4 Record before/after artifact counts.

### Scratch File Inventory
| Scratch File | Classification | Purpose / Rationale |
|---|---|---|
| `scratch/fixtures/*` | Test Fixture | Shared mock observation and AppMap data |
| `scratch/liveChecks.ts` | Manual / Live Harness | Live crawler checks on external targets |
| `scratch/liveLinks.ts` | Manual / Live Harness | Live HTTP reachability probe for test links |
| `scratch/measure.ts` | Manual / Live Harness | Multi-site benchmark runner and metrics collection |
| `scratch/runShowcase.ts` | Manual / Live Harness | Showcase test generation script |
| `scratch/sseSoak.ts` | Manual / Live Harness | Long-running SSE stream stability testing |
| `scratch/testAssertionGuard.ts` | Archive Candidate | Early assertion validator test; superseded by testPredeploy |
| `scratch/testPersistence.ts` | Archive Candidate | Early DB persistence unit check |
| `scratch/testPhase11.ts` | Archive Candidate | Milestone test for Phase 11; preserved for CI curation |
| `scratch/testPhase11C.ts` | Archive Candidate | Milestone test for Phase 11C; preserved for CI curation |
| `scratch/testPhase11_1C.ts` | Archive Candidate | Milestone test for Phase 11.1C; preserved for CI curation |
| `scratch/testPhase12.ts` | Canonical Regression | Phase 12 core assertions suite (URL pattern, errors, planner fallback, compileTest) |
| `scratch/testPhase12Legacy.ts` | Canonical Regression | Phase 12 BYOK isolation, auth, TPM skipping, test-data resolve/enforce suite |
| `scratch/testPhase6.ts` | Archive Candidate | Milestone test for Phase 6; preserved for CI curation |
| `scratch/testPhase7A.ts` | Archive Candidate | Milestone test for Phase 7A; preserved for CI curation |
| `scratch/testPhase8.ts` | Archive Candidate | Milestone test for Phase 8; preserved for CI curation |
| `scratch/testPhase9A.ts` | Archive Candidate | Milestone test for Phase 9A; preserved for CI curation |
| `scratch/testPhase9A1.ts` | Canonical Regression | Phase 9A.1 security hardening and isolation test suite |
| `scratch/testPipeline.ts` | Archive Candidate | Early pipeline wiring check |
| `scratch/testPredeploy.ts` | Canonical Regression | Pre-deploy serialization, observation budget, test-data preservation |
| `scratch/testQF2.ts` | Canonical Regression | Batch QF2 quick-fix verification (toHaveURL, toHaveCount, visibility, bot-wall, dual-call cap) |
| `scratch/testQuickFixes.ts` | Canonical Regression / Live Harness | Real local DB quick-fixes verification |
| `scratch/testRunnerIsolation.ts` | Archive Candidate | Runner isolation check |
| `scratch/testTrace.ts` | Canonical Regression | Trace store lifecycle, TTL, FIFO eviction, byte ceiling (256MB), token verification |

## P4 — User Order 7: Simple Winston Logging
- [x] P4.1 Install `winston` in backend workspace (`pnpm add winston` in backend).
- [x] P4.2 Add `backend/src/observability/logger.ts` (Console transport only, JSON in prod, single-line in dev, redaction helper).
- [x] P4.3 Migrate central hotspots: `index.ts`, `llm/client.ts`, `pipeline.ts`, `executor.ts`, `traceStore.ts`.
- [x] P4.4 Report remaining `console.*` count in `backend/src` (68 remaining).
- [x] P4.5 Run backend typecheck and tests. Boot-log evidence: NOT RUN (servers were not running at start of P4).

## P5 — User Order 8: README Update Now
- [x] P5.1 Deployment architecture Mermaid diagram (Vercel Next.js -> Render Docker Express -> Supabase; Render runs Playwright container; Render -> Groq/Gemini APIs; UptimeRobot).
- [x] P5.2 Code-workflow mapping.
- [x] P5.3 Database schema erDiagram from `schema.prisma`.
- [x] P5.4 Storage/state matrix.
- [x] P5.5 Trace retention update (200 traces, 256 MiB total cap, 25 MiB single trace, FIFO, 1h TTL).
- [x] P5.6 Winston logging documentation.
- [x] P5.7 Remove NVIDIA statements; describe Groq/Gemini model IDs as environment-configurable.
- [x] P5.8 Fix stale citations without modifying Measured Results section.

## P6 — User Order 3: Detailed Model Benchmark
- [x] P6.0 Create `backend/scratch/benchmarkModels.ts` harness (resumable, checkpointing, rate-limit pacing, fixtures, no BYOK).
- [x] P6.1 Catalog and quota discovery.
- [x] P6.2 Frozen task fixtures: Site A (TodoMVC) & Site B (the-internet login).
- [x] P6.3 Task-isolated evaluations per candidate:
  - Planner dual (Site A & B)
  - Single/focus planner
  - Planner repair
  - Expansion
  - Generator fallback
  - Corrector
- [x] P6.4 Shortlist full-pipeline benchmark (at most 3 configs across TodoMVC, the-internet, saucedemo).
- [x] P6.5 Scaling probe for Standard vs Extended decision.
- [x] P6.6 Final benchmark report written to `docs/measurements/2026-10-model-benchmark.md`.

## P7 — User Order 2: Implement Configurable Model Arrays & Fallbacks
- [x] P7.1 Centralize model routing in `backend/src/llm/providers.config.ts`.
- [x] P7.2 Support ordered chains with 1 primary + up to 2 fallbacks (`GEMINI_REASONING_MODELS`, `GEMINI_FAST_MODELS`, `GROQ_REASONING_MODELS`, `GROQ_FAST_MODELS`).
- [x] P7.3 Backward compatibility for singular model env vars.
- [x] P7.4 Task labels added to LLM requests (`plan-core`, `plan-negative`, `plan-single`, `plan-repair`, `plan-expand`, `generate`, `correct`).
- [x] P7.5 `MODEL_UNAVAILABLE` error classification for model-advance only.
- [x] P7.6 Create `backend/scratch/checkModelCatalog.ts`.
- [x] P7.7 Update `backend/.env.example`, `render.yaml`, docs.
- [x] P7.8 Verification tests for routing and fallback logic.

## P8 — User Order 4: Standard vs Extended Decision Only
- [x] P8.1 Formulate recommendations in benchmark report and final report (targets, caps, token budget multiplier, credits, runtime multiplier).
- [x] P8.2 Keep production toggles/caps unchanged.

---

## Verification Log
| Stage | Command | Result (PASS/FAIL/NOT RUN) | Verbatim Key Output / Evidence |
|---|---|---|---|
| P0 | git status / log / diff | PASS | Clean base HEAD 7d4b093 + uncommitted B7 closure in IMPLEMENTATION_TODO.md |
| P1 | git grep -n -i "nvidia" -- backend/src backend/.env.example render.yaml Readme.md docs/DEPLOY.md docs/OPERATIONS.md | PASS | Exit code 1 (zero matches across functional code, configs, and active docs) |
| P1 | pnpm run typecheck (backend) | PASS | `$ tsc --noEmit` exited with 0 |
| P1 | pnpm exec tsx scratch/testPhase9A1.ts | PASS | `=== ALL PHASE 9A.1 TESTS PASSED ===` |
| P1 | pnpm exec tsx scratch/testPredeploy.ts | PASS | `--- testPredeploy summary: ALL PASSED ---` |
| P1 | pnpm exec tsx scratch/testQF2.ts | PASS | `=== All 10 Batch QF2 Verification Tests Passed! ===` |
| P1 | pnpm exec tsx scratch/testPhase12.ts | PASS | `=== Verification Finished with exitCode=0 ===` |
| P1 | pnpm exec tsx scratch/testPhase12Legacy.ts | PASS | `All 14 testPhase12 assertions passed successfully!` |
| P2 | pnpm exec tsx scratch/testTrace.ts | PASS | `PASS T1..T5, T8 FIFO/count + byte eviction planning; === ALL TRACE TESTS PASSED ===` |
| P2 | pnpm run typecheck (backend) | PASS | `$ tsc --noEmit` exited with 0 |
| P3 | git rm & node cleanup script | PASS | Removed 4 tracked files (IMPLEMENTATION_TODO.md, runTestPredeploy.ts, 2 audit reports); cleaned 621 json logs, 3 zip traces, 3 test dirs, measure_results.json |
| P4 | logger redaction unit checks | PASS | `REDACTION UNIT TESTS PASSED` (Bearer, Groq, Gemini, Postgres URLs, trace tokens, sensitive keys) |
| P4 | logger prod JSON formatting | PASS | `{"apiKey":"[REDACTED]","component":"Server","jobId":"job-123","level":"info","message":"Test prod json line","timestamp":"..."}` |
| P4 | pnpm run typecheck (backend) | PASS | `$ tsc --noEmit` exited with 0 |
| P4 | pnpm exec tsx scratch/testTrace.ts | PASS | Structured logs formatted, T1..T5, T8 pass (`=== ALL TRACE TESTS PASSED ===`) |
| P4 | pnpm exec tsx scratch/testPhase9A1.ts | PASS | `=== ALL PHASE 9A.1 TESTS PASSED ===` |
| P4 | pnpm exec tsx scratch/testPredeploy.ts | PASS | `--- testPredeploy summary: ALL PASSED ---` |
| P4 | pnpm exec tsx scratch/testQF2.ts | PASS | `=== All 10 Batch QF2 Verification Tests Passed! ===` |
| P4 | pnpm exec tsx scratch/testPhase12.ts | PASS | `=== Verification Finished with exitCode=0 ===` |
| P4 | pnpm exec tsx scratch/testPhase12Legacy.ts | PASS | `All 14 testPhase12 assertions passed successfully!` |
| P4 | remaining console.* in backend/src | PASS | 68 remaining |
| P4 | boot-log evidence | NOT RUN | Servers were not running prior to P4 |
| P5 | Readme.md architecture/schema/workflow update | PASS | Added deployment flowchart, code workflow mapping table, Prisma erDiagram with cascades/indexes, storage/state matrix, Winston logging doc, trace retention (200 traces, 256 MiB cap, FIFO), 0 nvidia matches, Measured Results preserved byte-for-byte |
| P6 | pnpm exec tsx scratch/checkModelCatalog.ts | PASS | Groq catalog reachable (gpt-oss-120b, 20b, qwen3.8-27b); Gemini catalog reachable (gemini-2.5-flash-lite 404 retired, gemini-3.5-flash, 3.5-flash-lite, 3.1-flash-lite, 2.5-flash active) |
| P6 | pnpm exec tsx scratch/benchmarkModels.ts | PASS | Tasks 1–8.5 executed with <=4 calls/min pacing, frozen fixtures Site A & B, Task 8 scaling probe (8, 12, 16), Task 8.5 shortlist pipeline runs (Groq primary, Gemini primary, Hybrid preview) |
| P6 | docs/measurements/2026-10-model-benchmark.md | PASS | Comprehensive benchmark report written with executive summary, quota discoveries, 8 task tables, shortlist comparison, scaling probe analysis |
| P7 | pnpm run typecheck (backend) | PASS | `$ tsc --noEmit` exited with 0 |
| P7 | pnpm exec tsx scratch/testFallbackChains.ts | PASS | `=== ALL FALLBACK CHAIN VERIFICATION TESTS PASSED SUCCESSFULLY ===` (parseModelChain, defaults, MODEL_UNAVAILABLE 404/400, in-provider fallback 120b->qwen, cross-provider fallback groq->gemini, task labels) |
| P7 | pnpm exec tsx scratch/testTrace.ts | PASS | Structured logs formatted, T1..T5, T8 pass (`=== ALL TRACE TESTS PASSED ===`) |
| P7 | pnpm exec tsx scratch/testPhase9A1.ts | PASS | `=== ALL PHASE 9A.1 TESTS PASSED ===` |
| P7 | pnpm exec tsx scratch/testPredeploy.ts | PASS | `--- testPredeploy summary: ALL PASSED ---` |
| P7 | pnpm exec tsx scratch/testQF2.ts | PASS | `=== All 10 Batch QF2 Verification Tests Passed! ===` |
| P7 | pnpm exec tsx scratch/testPhase12.ts | PASS | `=== Verification Finished with exitCode=0 ===` |
| P7 | pnpm exec tsx scratch/testPhase12Legacy.ts | PASS | `All 14 testPhase12 assertions passed successfully!` |
| P8 | Standard vs Extended Decision | PASS | Standard: 5–8 cases, budget 40k, 1 credit, timeout scale 1.0x; Extended: 8–12 cases, budget 65k, 2 credits, timeout scale 1.5x. Production caps & toggles kept unchanged. |

## Quota & Blocker Log
- Quota: Pacing set to <= 4 calls/minute rolling window per provider to stay strictly within rate limits.
- Blockers: None. Stopped cleanly before Stage 9 (deploy), Stage 6 (DB row cleanup), Stage 10 (GitHub Actions), and Stage 11 (UptimeRobot).

