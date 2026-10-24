# Implementation Todo — Pre-deploy simplification + Replay for every execution attempt + P0 bugs + negative-case test-data fix

Status: COMPLETE
CURRENT POINTER: complete
Execution order: S0 -> S1 -> S2 -> S3 -> S4 -> S5 -> S7 -> S6
Base HEAD: 302006a
Branch: main
Spec: The user's implementation prompt in this chat, plus the S7 addendum. If resuming in a new session without that prompt, ask the user to re-paste it before code edits.

Legend: [ ] pending | [~] in progress | [x] done + verified | [!] blocked

## Pre-existing working-tree changes (before implementation; preserve)
Verbatim git status --short:
```
 M Readme.md
 M backend/.env.example
 M docs/measurements/2026-10-phase12-measurement.md
?? IMPLEMENTATION_TODO.md
?? docs/audits/
```

## S0 — Baseline
- [x] S0.1 Create/replace this todo; record base HEAD/branch/status above.
- [x] S0.2 Verify current-code facts by grep: getTraceLinks missing headers; trace:true only in testRerun; traceExpiresAt last-attempt-only; rerun route; next.config rewrites only /api. Record mismatches under Blockers/discrepancies.

## S1 — Small correctness batch
- [x] S1.1 Guard planner leading-navigate new URL() (no throw on malformed value).
- [x] S1.2 serializeObservations(observations, maxChars=6000): valid JSON via whole-item thinning; never slice serialized JSON; export it.
- [x] S1.3 Zero-plan guard in finalizePlan after enforceTestData, before cache: 0 cases -> BAD_RESPONSE.
- [x] S1.4 Pipeline corrector uses serializeObservations(appMap.observations, 4000); remove .slice(0, 2000).
- [x] S1.5 Frontend index.tsx: BROWSER_LAUNCH_FAILED/UPSTREAM_UNAVAILABLE handled before TARGET_WAKING/bare-503 branch in handleCrawl and retryCrawl.
- [x] S1.6 Add backend/scratch/testPredeploy.ts P1-P3; run it + backend typecheck; log results.

## S2 — Trace for every execution attempt
- [x] S2.1 Executor: multi-trace harvest onTraceZips keyed by fileStem (JSON trace attachments primary, outputDir scan fallback), before runDir cleanup, best-effort only.
- [x] S2.2 rounds.ts: executeBatch(files, executionMeta) with filename/testCaseId/attemptNumber per file.
- [x] S2.3 pipeline.ts: load traceOwnerId from DB (visitorId ?? ''); trace:true in batch + per-file fallback; register every execution-attempt trace.
- [x] S2.4 traceStore: same (jobId,testCaseId,attemptNumber,visitorId) registration replaces the old entry/file.
- [x] S2.5 jobDetail: traceExpiresAt on EVERY attempt with a live trace, owner/local-unclaimed only; jobsRoutes trace-link uses effective owner (job.visitorId ?? '').
- [x] S2.6 frontend getTraceLinks sends visitor headers (use fetcher or buildHeaders + captureVisitorToken).
- [x] S2.7 next.config rewrites for /trace-viewer and /trace-viewer/:path*; viewer framing SAMEORIGIN only for /trace-viewer; verify via curl if servers boot.
- [x] S2.8 testTrace: add duplicate-replace case; live two-file onTraceZips mapping case; run non-live + TRACE_LIVE=1 + backend typecheck; log attachment evidence/sizes.

## S3 — Replay UI
- [x] S3.1 New frontend/components/job/ReplayPanel.tsx: attempt list, fresh signed links per selection, iframe (relative viewerPath), Download/Open full screen/Refresh, expired state, privacy notice.
- [x] S3.2 Job page: Test cases | Replay tabs, selection state, live replay count; hidden/disabled in share view; existing SSE/SWR refresh only.
- [x] S3.3 TestResultCard: replace Open/Download trace block with single View replay button (latest traceable attempt); remove card getTraceLinks/apiBase usage.
- [x] S3.4 globals.css Replay styles, responsive, existing conventions.
- [x] S3.5 Frontend typecheck + lint; manual Replay check if env allows (job id, trace count/sizes, share-view hidden) or NOT RUN + reason.

## S4 — Remove edit / rerun / Show browser entirely
- [x] S4.1 Delete backend/src/agent/testRerun.ts + backend/scratch/testRerun.ts; remove rerun POST route (keep/rename params schema used by trace GET).
- [x] S4.2 Remove dead RERUN_*/BASELINE_NOT_EDITABLE/TEST_DATA_REQUIRED codes after grep proves unused. Keep TRACE_NOT_FOUND.
- [x] S4.3 Remove RERUN_DAILY_LIMIT from config.ts + .env.example (preserve retention vars); remove dead executor headless override only if grep proves sole caller was testRerun. Keep global HEADLESS/HEADED_DEBUG plumbing.
- [x] S4.4 TestResultCard/job page/types/jobDetail: remove all editing/headed/rerun state, UI, polling, Edited badge, canEdit end-to-end, unused onRefresh. Keep code/diff/error tabs.
- [x] S4.5 lib/api: delete rerunTest + types. CodeViewer: read-only only (remove editable/onChange).
- [x] S4.6 Zero-grep proof for rerunTest|startTestRerun|RERUN_DAILY_LIMIT|Show browser|/rerun in backend/src + frontend + backend/.env.example; backend/frontend typecheck; frontend lint.

## S5 — Conservative negative-case test-data segregation
- [x] S5.1 Server-assigned internal intent (dual side B = negative; single-call title/description inference; never from model JSON; strip before cache/return).
- [x] S5.2 enforceTestData: negative cases keep explicit '' and planner-chosen invalid literals; positive behavior unchanged.
- [x] S5.3 PromptB negative override line; alert-role line only if absent; no duplicated prompt rules.
- [x] S5.4 Extend testPredeploy P4-P6; run testPredeploy, testPhase12Legacy, testQF2, testPhase12. If this cannot be done without field-label guessing, mark S5 [!] with evidence instead of hacking.

## S7 — 5-job dock/toast count (addendum; run before S6)
- [x] S7.1 This stage recorded in todo.
- [x] S7.2 ActiveJobsDock: poll ALL tracked entries (remove polling .slice(0, 3)); render up to MAX_URLS_PER_RUN (5) non-current-page entries; header shows true non-current-page count; scrollable list; "+N more in Jobs history" overflow row if needed.
- [x] S7.3 _app.tsx: Toaster visibleToasts={5}.
- [x] S7.4 Re-derive README line citations shifted by this diff (especially jobsRoutes export.zip citation); correct only wrong citations.
- [x] S7.5 Frontend typecheck + lint; zero-grep slice(0, 3) in ActiveJobsDock; manual 5-job dock check from Home/Jobs if available, else NOT RUN + reason.

## S6 — Docs sync + final verification
- [x] S6.1 README/DEPLOY/OPERATIONS: remove rerun/edit/headed/RERUN_DAILY_LIMIT statements; document every-execution-attempt traces + Replay tab (owner-only, 1 hour). Preserve pre-existing README fixes + Measured Results byte-for-byte. No LICENSE file.
- [x] S6.2 Final verification: backend typecheck; frontend typecheck + lint; testPredeploy; testTrace (incl. TRACE_LIVE=1); testQF2; testPhase12; testPhase12Legacy; testPhase9A1; testQuickFixes; git diff --stat; git status --short.
- [x] S6.3 Record final trace evidence (sample count/sizes/cap eviction) and set CURRENT POINTER to complete or the exact blocked task.

## Files touched
| Task | Files | Notes |
|---|---|---|
| S3 | frontend/components/job/ReplayPanel.tsx, frontend/pages/jobs/[id].tsx, frontend/components/job/TestResultCard.tsx, frontend/styles/globals.css | Replay panel, attempt list, signed trace viewer iframe, responsive styles, job page tab navigation |
| S4 | backend/src/agent/testRerun.ts (deleted), backend/scratch/testRerun.ts (deleted), backend/src/api/jobsRoutes.ts, backend/src/api/jobErrors.ts, backend/src/api/errors.ts, backend/src/config.ts, backend/.env.example, backend/src/runner/executor.ts, backend/src/agent/jobDetail.ts, frontend/types/api.ts, frontend/lib/api.ts, frontend/components/code/CodeViewer.tsx, frontend/components/job/TestResultCard.tsx, frontend/pages/jobs/[id].tsx | Complete removal of edit / rerun / Show browser / canEdit |
| S5 | backend/src/agent/prompts/plannerPrompt.ts, backend/src/agent/steps/planner.ts, backend/scratch/testPredeploy.ts | Internal intent tag on negative cases, test-data segregation in enforceTestData, promptB + system prompt rules |
| S7 | frontend/components/layout/ActiveJobsDock.tsx, frontend/pages/_app.tsx, Readme.md | 5-job dock polling & rendering, Toaster visibleToasts=5, shifted README line citations corrected |
| S6 | Readme.md | Removed rerun/edit/headed/RERUN_DAILY_LIMIT, documented every-attempt traces + Replay tab |

## Verification log
| Task | Command | Result (PASS/FAIL/NOT RUN) | Evidence |
|---|---|---|---|
| S0.2 | grep getTraceLinks | PASS | api.ts:414 no buildHeaders/captureVisitorToken |
| S0.2 | grep trace: in backend/src | PASS | only testRerun.ts:214 sets trace:true |
| S0.2 | grep traceExpiresAt | PASS | jobDetail.ts:94-98 last-attempt-only |
| S0.2 | grep rerun route | PASS | jobsRoutes.ts:205 POST /:id/tests/:testCaseId/rerun |
| S0.2 | view next.config.js | PASS | rewrites only /api/:path* (line 12) |
| S1.6 | npx ts-node scratch/testPredeploy.ts | PASS | P1-P3 pass (valid JSON, budget, zero-plan) |
| S1.6 | npm run typecheck (backend & frontend) | PASS | Both pass with 0 errors |
| S2.8 | npx ts-node scratch/testTrace.ts | PASS | T1-T5 pass (T5 duplicate-replace verified) |
| S2.8 | TRACE_LIVE=1 npx ts-node scratch/testTrace.ts | PASS | T6 & T7 pass; tc-1: 8825 bytes, tc-2: 73676 bytes |
| S2.8 | npm run typecheck (backend & frontend) | PASS | Both pass with 0 errors |
| S3.5 | npm run typecheck (frontend & backend) | PASS | Both pass with 0 errors |
| S3.5 | npm run lint (frontend) | PASS | ReplayPanel 0 warnings/errors (only pre-existing warning in index.tsx) |
| S3.5 | manual Replay check | NOT RUN | Dev servers not booted in background; automated typecheck & lint verified |
| S4.6 | git grep -E "rerunTest\|startTestRerun\|RERUN_DAILY_LIMIT\|Show browser\|/rerun" | PASS | Zero matches found in backend/src, frontend, backend/.env.example |
| S4.6 | npm run typecheck (backend & frontend) | PASS | Both pass with 0 errors |
| S4.6 | npm run lint (frontend) | PASS | 0 errors |
| S5.4 | npx ts-node scratch/testPredeploy.ts | PASS | P1-P6 all pass (empty fill kept, invalid literal kept, positive substituted) |
| S5.4 | npx tsx scratch/testPhase12Legacy.ts | PASS | All 14 assertions pass (group 9 enforceTestData pass) |
| S5.4 | npx tsx scratch/testQF2.ts | PASS | All 10 groups pass |
| S5.4 | npx tsx scratch/testPhase12.ts | PASS | All groups pass (P1-P6, P8-P10) |
| S5.4 | npm run typecheck (backend & frontend) | PASS | Both pass with 0 errors |
| S7.5 | git grep -n "slice(0, 3)" -- frontend/components/layout/ActiveJobsDock.tsx | PASS | Zero matches |
| S7.5 | npm run typecheck (frontend) | PASS | Passed with 0 errors |
| S7.5 | npm run lint (frontend) | PASS | Passed (0 errors, 1 pre-existing warning in index.tsx) |
| S7.5 | manual 5-job dock check | NOT RUN | Live servers not booted in background; static and type check verified |
| S6.2 | npm run typecheck (backend & frontend) | PASS | Both pass with 0 errors |
| S6.2 | npm run lint (frontend) | PASS | 0 errors |
| S6.2 | npx ts-node scratch/testPredeploy.ts | PASS | P1-P6 all pass |
| S6.2 | TRACE_LIVE=1 npx ts-node scratch/testTrace.ts | PASS | T1-T7 pass; tc-1: 70968 bytes, tc-2: 73671 bytes |
| S6.2 | npx tsx scratch/testQF2.ts | PASS | 10/10 groups pass |
| S6.2 | npx tsx scratch/testPhase12.ts | PASS | All groups pass |
| S6.2 | npx tsx scratch/testPhase12Legacy.ts | PASS | All 14 assertions pass |
| S6.2 | npx tsx scratch/testPhase9A1.ts | PASS | All T1-T8 pass |
| S6.2 | npx tsx scratch/testQuickFixes.ts | PASS | All 10 quick-fix checks pass |

## Blockers / discrepancies
- S0.2: All five baseline facts confirmed as expected — no mismatches.

## Deferred by design (do not implement in this run)
Share-link owner-gating redesign; localStorage remembering change; queue TOCTOU cap; stale-job sweeper; visitor-token expiry; count-observation attribution; planner token/prompt shrink; assertion-dropping grounding screen; structured corrector packet beyond S1.4; live video/screencast; post-login multi-state App Map; pnpm pin/deepmerge-ts bump; copy polish.
