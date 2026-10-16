# Autonomous Test Suite Generator

In progress (agentic self-healing loop). Backend in `backend/` (Express 5 + TypeScript + Prisma/Supabase + Playwright).

## API notes (Phase 6)

- `POST /api/generate` with `{ "url": "..." }` — single run, original response shape (`{ jobId, appMap, testPlan, generatedTests }`; each generated test now also carries a `confidence` score).
- `POST /api/generate` with `{ "urls": ["...", "..."] }` — batch mode (max 5 URLs, duplicates run once, at most 2 pipelines concurrently). Always responds 200 with per-URL outcomes: `{ results: [{ url, status: "completed", jobId, testCount, passedCount, failedCount, gaveUpCount, generatedTests: [{ testCaseId, filename, status, totalAttempts, confidence }] } | { url, status: "failed", error: { error, message } }], summary: { total, succeeded, failed } }`. Fetch `GET /api/jobs/:jobId` for full detail, `report.html`, or `export.zip` per job.
- `GET /api/jobs/:id` additionally returns `costEstimate: { totalUsd, totalPromptTokens, totalCompletionTokens, totalTokens, calls, unpricedCalls, byProvider: [{ provider, calls, promptTokens, completionTokens, totalTokens, usd, priced }] }` and a per-test `confidence: { score, band, factors }`. Both are computed on read from persisted agent steps/tests — no schema columns. Prices live in `backend/src/llm/pricing.config.ts` (Groq `openai/gpt-oss-120b` $0.15/$0.60 per 1M in/out; Gemini $0 on the free tier); `priced: false` / `unpricedCalls > 0` means the total is a lower bound.
- Confidence is a heuristic 0–100 (selector specificity, assertion count, interaction coverage, correction history, final status/failure class) with an itemised `factors` breakdown; the HTML report shows the same score per test and the cost table per job.
- Verification (no DB/LLM needed): `cd backend && corepack pnpm exec tsx scratch/testPhase6.ts`
