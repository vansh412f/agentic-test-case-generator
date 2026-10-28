<div align="center">

# Agentic Test Case Generator

Generates typed Playwright end-to-end test suites from live web applications using deterministic DOM inspection and bounded correction loops.

<p>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.9.3" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22_(tested_v24.14.1)-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 22 (Docker image node:22-bookworm-slim); tested on v24.14.1" /></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-14.2.5_(Pages_Router)-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js 14.2.5" /></a>
  <a href="https://expressjs.com/"><img src="https://img.shields.io/badge/Express-5.2.1-000000?style=flat-square&logo=express&logoColor=white" alt="Express 5.2.1" /></a>
  <a href="https://playwright.dev/"><img src="https://img.shields.io/badge/Playwright-1.63.0-2EAD33?style=flat-square&logo=playwright&logoColor=white" alt="Playwright 1.63.0" /></a>
  <a href="https://cloud.google.com/run"><img src="https://img.shields.io/badge/Google_Cloud_Run-Remote_Chromium_WS-4285F4?style=flat-square&logo=googlecloud&logoColor=white" alt="Google Cloud Run - Remote Chromium WS" /></a>
  <a href="https://www.prisma.io/"><img src="https://img.shields.io/badge/Prisma-6.19.3-2D3748?style=flat-square&logo=prisma&logoColor=white" alt="Prisma 6.19.3" /></a>
  <a href="https://supabase.com/"><img src="https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white" alt="Supabase PostgreSQL" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind_CSS-3.4.17-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS 3.4.17" /></a>
  <a href="https://github.com/vansh412f/agentic-test-case-generator/actions/workflows/ci.yml"><img src="https://github.com/vansh412f/agentic-test-case-generator/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
</p>

<p>
  <a href="#how-it-works">How it works</a> &middot;
  <a href="#deployment-architecture">Deployment architecture</a> &middot;
  <a href="#code-workflow">Code workflow</a> &middot;
  <a href="#database-schema">Database schema</a> &middot;
  <a href="#storage--state-matrix">Storage &amp; state</a> &middot;
  <a href="#test-lifecycle">Test lifecycle</a> &middot;
  <a href="#architecture-decisions">Architecture decisions</a> &middot;
  <a href="#security-model">Security</a> &middot;
  <a href="#limits--modes">Limits &amp; modes</a> &middot;
  <a href="#measured-results">Measured results</a> &middot;
  <a href="#run-locally">Run locally</a> &middot;
  <a href="#api-reference">API</a>
</p>

</div>

---

## What It Does

- **Discovers interactive state directly from the DOM:** Navigates the target URL using headless Chromium, cataloging visible buttons, inputs, links, forms, and semantic accessibility roles into a structured AppMap. In hosted production, Chromium execution is offloaded over authenticated `wss://` to Google Cloud Run (`us-west1`), completely shielding the Render container from browser memory spikes.
- **Plans targeted test scenarios:** Submits the discovered element tree to an LLM reasoning model to design user journeys across validation, navigation, state changes, and negative edge cases.
- **Includes built-in baseline checks:** Automatically injects deterministic checks alongside AI scenarios: `smoke-1` (no uncaught JavaScript errors on load) and `smoke-2` (linked pages respond).
- **Compiles Playwright TypeScript deterministically:** Synthesizes typed test files using strict locator priority rules without model hallucination on the compiled path (falling back to generative LLM synthesis only when compilation throws `CompileError`).
- **Enforces a static compilation gate:** Pre-validates every emitted test via `tsc --noEmit` in a child process before executing any browser code.
- **Runs tests in isolated Chromium processes:** Executes generated tests in Chromium (Chromium-only execution) orchestrated by `@playwright/test` runner under `agtrunner` (UID 1001) with `netGuard.mjs`, delegating browser rendering to Google Cloud Run over authenticated WebSocket or running locally on workstations.
- **Classifies and isolates failures:** Distinguishes assertion discrepancies from mechanical harness failures (missing locators, network timeouts); mechanical failures undergo bounded correction while assertion failures are preserved.
- **Exports complete test suites:** Packages validated tests into a runnable Playwright project zip complete with `playwright.config.ts`, `.env.example`, and a GitHub Actions workflow.
- **Serves owner-only Playwright trace replay for every execution attempt:** Every test execution attempt (initial runs and corrector passes) captures a Playwright trace zip retained in ephemeral storage with a 200-trace cap, 256 MiB total retained byte ceiling, 25 MiB single trace limit, FIFO eviction by createdAt, and 1-hour TTL (`backend/src/runner/traceStore.ts`). Traces stream from Cloud Run to Render at test teardown. The job page **Replay** tab provides an embedded trace viewer and direct zip download, gated to the job owner via signed tokens with a 10-minute TTL.
- **Accepts per-site test data without persisting secrets server-side:** Form credentials are supplied per normalized target URL (`TestDataEntrySchema`, `backend/src/api/schemas.ts`) and replaced with `__AGT_SECRET_n__` placeholders before planning or storage; real values are substituted only at execution time on the ephemeral file. Secrets are never stored in the database and never sent to the model. Credentials the user asks to remember are kept only in their own browser `localStorage` (30 days) for prefill. Password fields without a user-provided value are never filled with invented values — such forms are covered only with empty/validation cases.
- **Streams live execution feedback over SSE:** Delivers real-time phase updates, step durations, sub-second running clocks, and token usage increments directly to the browser UI without client-side polling.

---

## How It Works

```mermaid
sequenceDiagram
  autonumber
  actor User as Browser UI
  participant Next as Next.js Proxy (:3000)
  participant API as Express API (:4000)
  participant Queue as Run Queue
  participant Runner as Playwright Coordinator (agtrunner UID 1001)
  participant CloudBrowser as Google Cloud Run (us-west1 Chromium WS)
  participant Planner as LLM Planner (dual-call: 120B + 20B / Cache)
  participant Compiler as AST Compiler
  participant TSC as tsc Pre-flight Gate
  participant DB as Supabase Postgres
  participant SSE as SSE Stream

  User->>Next: POST /api/generate
  Next->>API: Forward request with Edge Secret
  API->>DB: Create pending Job records
  API->>Queue: Enqueue Run Group
  API-->>User: 202 Accepted (jobIds, runGroupId)
  User->>SSE: GET /api/jobs/:id/stream

  Queue->>CloudBrowser: crawlPage(targetUrl) via wss://
  CloudBrowser-->>Queue: AppMap (elements, forms, links)

  Queue->>CloudBrowser: observeAppMap(appMap) via wss://
  CloudBrowser-->>Queue: Observations (navigation / popup / form-submit / count)
  Queue->>SSE: emit phase_change: planning

  Queue->>Planner: planTests(appMap, observations)
  Planner-->>Queue: TestPlan (reasoning core cases + fast negative cases)
  Queue->>Compiler: compileTest(testCase, elements)
  Compiler-->>Queue: Spec file code

  Queue->>TSC: validateTestCode(specFiles)
  alt Syntax or type error
    TSC-->>Queue: Diagnostic errors
    Queue->>Queue: Request corrector (20B fast model)
  else Types valid
    TSC-->>Queue: Validation passed
  end

  Queue->>Runner: executeTests(specFiles) via setpriv + netGuard
  Runner->>CloudBrowser: connectOptions.wsEndpoint (wss://)
  CloudBrowser-->>Runner: Playwright JSON test report & trace.zip streams
  Runner-->>Queue: Aggregated results & trace registrations
  Queue->>DB: Persist execution results & final status
  Queue->>SSE: emit test_completed & job_finished
```

### Execution Walkthrough

1. **Submission & Admission (`backend/src/api/routes.ts`):** Client submits target URLs with an ALTCHA proof-of-work payload. The API enforces public network policy (`assertPublicTarget`), checks daily quotas, verifies the signed visitor ID sent in the `X-Visitor-Id` header, and pushes the run into the in-process queue.
2. **DOM Crawl (`backend/src/crawler/pageCrawler.ts`):** In hosted mode (`LOCAL_AGENT_MODE=false`), Chromium connects remotely over authenticated `wss://` to Google Cloud Run (`us-west1`, `2 vCPU / 2 GiB`, `min-instances=0`) via `backend/src/browser/remoteBrowser.ts` with zero local Chromium fallback. Headless Chromium navigates to the target, collects interactive elements, computes accessible roles and CSS selectors, and serializes the DOM into an AppMap. In local mode (`LOCAL_AGENT_MODE=true`), local Chromium is used directly so `localhost` and `127.0.0.1` targets work out of the box.
3. **Grounded Observation (`backend/src/crawler/observe.ts`, invoked during `runPipeline` in `backend/src/agent/pipeline.ts`):** The remote headless Chromium instance drives the crawled page to record **grounded facts** before planning: `navigation` (where a link leads), `popup` (popups opened by links), `form_empty_submit` (submit with empty fields), `form_filled_submit` (submit with provided test data), and `count` (repeated-item counts). Observation is bounded (`MAX_OBSERVATIONS=25`, 5 s per action, 45 s overall deadline, up to 6 links and 3 forms) and best-effort — it records what it can and **never fails the job**; if the AppMap already carries observations, the step is skipped.
4. **Plan Synthesis (`backend/src/agent/steps/planner.ts`):** The AppMap and its observations are checked against the in-memory plan cache. On a cache miss, the planner runs in **dual-call** mode: a high-reasoning model plans core cases and a fast model plans negative cases, bounded by `MAX_AI_TEST_CASES` and `MAX_TEST_CASES` (`backend/src/agent/run.config.ts`). When focus elements are supplied (via the optional `focus` field on `POST /api/generate`), the planner runs a single constrained call instead.
5. **Deterministic Compilation (`backend/src/agent/steps/compiler.ts`):** Scenarios are mapped directly into `@playwright/test` TypeScript files by looking up referenced elements from the AppMap.
6. **Static Type-Check Gate (`backend/src/runner/validator.ts`):** Emitted test code is written to an ephemeral directory with a scoped `tsconfig.json` and compiled with `tsc --noEmit`.
7. **Sandboxed Execution (`backend/src/runner/executor.ts`):** In production Linux containers, `@playwright/test` worker coordinator executes under an unprivileged user (`agtrunner`, UID 1001) governed by `netGuard.mjs`. When `BROWSER_WS_ENDPOINT` is configured, `playwright.config.ts` passes `connectOptions.wsEndpoint` with an authenticated `wss://` URL to Google Cloud Run. Trace zips stream over the WebSocket back into Render's `.traces/` store, and Cloud Run destroys session temporary files immediately on disconnect.
8. **Triage & Correction Loop (`backend/src/agent/rounds.ts`):** Results are parsed. Passing tests are marked `passed`. Real assertion discrepancies become `failed`. Mechanical locator and timeout issues trigger correction attempts (up to 3 rounds) using a fast model.
9. **Persistence & Streaming (`backend/src/agent/jobEvents.ts`):** State transitions and test outcomes are saved in Supabase and pushed in real time to the browser UI over Server-Sent Events.

---

## Deployment Architecture

```mermaid
flowchart TD
  UserBrowser["User Browser"] -->|HTTPS / UI Interaction| Vercel["Vercel (Next.js Pages Router)"]
  Vercel -->|Rewrite /api/* + Edge Secret| Render["Render Docker Express (:4000)"]
  Render -->|Supavisor Pooler :6543| Supabase["Supabase PostgreSQL"]
  Render -->|HTTPS API Requests| LlmApis["Groq & Google Gemini APIs"]
  
  subgraph RenderHost ["Render Free Docker Container (node:22-bookworm-slim, 512 MB RAM / 0.1 CPU, Oregon)"]
    ExpressAPI["Express API Server (:4000)"]
    QueueEngine["HeavyOpGate(1) In-Process Run Queue"]
    TSCGate["tsc --noEmit Static Validator"]
    RunnerCoordinator["agtrunner (UID 1001) @playwright/test Runner Client + netGuard.mjs"]
    TraceStoreEngine["Ephemeral .traces Store (200 traces, 256 MiB cap, 1h TTL, FIFO)"]
    
    ExpressAPI --> QueueEngine
    QueueEngine --> TSCGate
    TSCGate --> RunnerCoordinator
    RunnerCoordinator -->|Trace Streams| TraceStoreEngine
  end

  subgraph CloudRunHost ["Google Cloud Run Service (us-west1 Oregon Always Free, 2 vCPU / 2 GiB, min=0, max=1)"]
    WsServer["server.mjs (timingSafeEqual Token Auth & WebSocket Multiplexer)"]
    RemoteChromium["chromium-headless-shell (Isolated Per-Connection launchServer)"]
    EgressSSRF["egressProxy.mjs (Connect-Time DNS Pinning SSRF Proxy)"]

    WsServer --> RemoteChromium
    RemoteChromium --> EgressSSRF
  end

  QueueEngine -->|Crawl & Observe over Authenticated wss://| WsServer
  RunnerCoordinator -->|connectOptions.wsEndpoint over Authenticated wss://| WsServer
  EgressSSRF -->|Public Egress Only| TargetSite["Target Web Application"]
  TraceStoreEngine -->|Signed Download & /trace-viewer| UserBrowser
  UptimeRobot["UptimeRobot Probe"] -->|Health Checks /api/health & /api/health/db| ExpressAPI
```

> [!IMPORTANT]
> **Hosted Two-Tier Browser Offload Architecture:**
> In hosted production, headless Chromium runs strictly on **Google Cloud Run (`us-west1`, `2 vCPU / 2 GiB`)** over authenticated `wss://` connections. Chromium **never** runs inside Render's 512 MB container, shielding the API process from cgroup OOM crashes while keeping `@playwright/test` process coordination under Linux UID 1001 (`agtrunner`) with `netGuard.mjs` network socket controls. In local development (`LOCAL_AGENT_MODE=true`), local Chromium is used directly.

---

## Code Workflow

The end-to-end execution path maps directly through the following architectural layers:

```mermaid
flowchart LR
  Routes["routes.ts<br/>(Validation & Admission)"] --> RunQueue["jobRunner.ts<br/>(Run Queue)"]
  RunQueue --> Pipeline["pipeline.ts<br/>(Orchestrator)"]
  Pipeline --> Crawl["pageCrawler.ts<br/>(DOM Catalog)"]
  Crawl --> Observe["observe.ts<br/>(Action Grounding)"]
  Observe --> Planner["planner.ts<br/>(Dual-Call Plan)"]
  Planner --> Compiler["compiler.ts<br/>(Deterministic AST)"]
  Compiler -.->|on CompileError| Generator["generator.ts<br/>(LLM Fallback)"]
  Compiler --> SafetyGate["codeSafety.ts & validator.ts<br/>(AST Check & tsc)"]
  Generator --> SafetyGate
  SafetyGate --> Rounds["rounds.ts<br/>(Execution & Triage)"]
  Rounds --> Executor["executor.ts<br/>(setpriv / UID 1001)"]
  Executor --> TraceStore["traceStore.ts<br/>(Ephemeral Traces)"]
  Rounds --> Corrector["corrector.ts<br/>(Assertion-Guarded Loop)"]
  Corrector --> SafetyGate
  Rounds --> Persistence["jobs.ts & jobEvents.ts<br/>(DB & SSE Stream)"]
  Persistence --> Frontend["Frontend UI<br/>(Replay / Job Detail / Export)"]
```

| Phase | Core Source File | Primary Responsibility |
|---|---|---|
| **1. Routes & Admission** | [`backend/src/api/routes.ts`](backend/src/api/routes.ts) | Request validation with Zod schemas, ALTCHA proof-of-work verification, IP & visitor rate-limiting, edge secret verification. |
| **2. Queue Management** | [`backend/src/agent/jobRunner.ts`](backend/src/agent/jobRunner.ts) | In-memory `runQueue` concurrency control, run-group lifecycle, non-blocking job detachment. |
| **3. Pipeline Orchestration** | [`backend/src/agent/pipeline.ts`](backend/src/agent/pipeline.ts) | Step sequencing, status transitions, phase announcements, trace owner resolution, confidence scoring. |
| **4. DOM Crawl** | [`backend/src/crawler/pageCrawler.ts`](backend/src/crawler/pageCrawler.ts), [`backend/src/browser/remoteBrowser.ts`](backend/src/browser/remoteBrowser.ts), & [`cloud-browser/`](cloud-browser/) | Headless Chromium navigation, interactive element indexing, role computation, AppMap generation via local Chromium or remote Cloud Run WebSocket. |
| **5. Action Grounding** | [`backend/src/crawler/observe.ts`](backend/src/crawler/observe.ts) | Empirical observation of navigation targets, popups, form submissions, and repeated elements without failing the job. |
| **6. Scenario Planning** | [`backend/src/agent/steps/planner.ts`](backend/src/agent/steps/planner.ts) | In-memory plan cache lookup, dual-call LLM prompt execution (reasoning core + fast negative), schema validation, self-repair. |
| **7. Code Synthesis** | [`backend/src/agent/steps/compiler.ts`](backend/src/agent/steps/compiler.ts) | Deterministic AST compilation using strict locator preference; falls back to [`generator.ts`](backend/src/agent/steps/generator.ts) on `CompileError`. |
| **8. Pre-Flight Safety Gate** | [`backend/src/runner/codeSafety.ts`](backend/src/runner/codeSafety.ts) & [`validator.ts`](backend/src/runner/validator.ts) | AST safety check (rejects process, child_process, dangerous filesystem APIs) followed by static type preflight (`tsc --noEmit`). |
| **9. Guarded Execution Rounds** | [`backend/src/agent/rounds.ts`](backend/src/agent/rounds.ts) | Multi-attempt test execution orchestration; error classification (`finding`, `locator`, `timeout`); bounded correction via [`corrector.ts`](backend/src/agent/steps/corrector.ts) with strict assertion preservation. |
| **10. Sandboxed Execution** | [`backend/src/runner/executor.ts`](backend/src/runner/executor.ts), [`backend/src/browser/remoteBrowser.ts`](backend/src/browser/remoteBrowser.ts), & [`cloud-browser/`](cloud-browser/) | Isolated execution via Linux `setpriv` (unprivileged `agtrunner` UID 1001), netGuard egress enforcement, Playwright remote WebSocket connection to Cloud Run, JSON report extraction. |
| **11. Trace Persistence** | [`backend/src/runner/traceStore.ts`](backend/src/runner/traceStore.ts) | Ephemeral zip trace store with 200-trace cap, 256 MiB byte ceiling, FIFO eviction by `createdAt`, and HMAC-signed 10-minute access tokens. |
| **12. Persistence & Streaming** | [`backend/src/db/jobs.ts`](backend/src/db/jobs.ts) & [`jobEvents.ts`](backend/src/agent/jobEvents.ts) | Transactional database recording to Supabase PostgreSQL and real-time SSE stream events dispatched to the frontend. |
| **13. UI Delivery & Export** | [`frontend/components/job/ReplayPanel.tsx`](frontend/components/job/ReplayPanel.tsx) & [`backend/src/export/projectExporter.ts`](backend/src/export/projectExporter.ts) | Embedded Playwright Trace Viewer rendering in browser, direct trace zip download, and standalone runnable Playwright project zip download. |

---

## Test Lifecycle

```mermaid
stateDiagram-v2
  [*] --> open: Test emitted from planner or baseline

  open --> passed: Execution passed on attempt 1..3
  open --> failed: Finding detected (assertion failed after locator resolved)
  open --> needs_review: Stale expectation (target page redirected or element vanished)
  open --> gave_up: Unrecoverable or limits exhausted

  open --> open: Mechanical failure (locator / timeout) & rounds < 3 & budget available

  passed --> [*]
  failed --> [*]
  needs_review --> [*]
  gave_up --> [*]
```

### Transition Rules

- **`open -> passed`:** The Playwright test executed to completion with all assertions satisfied.
- **`open -> failed`:** Execution failed with a classified `finding` (an assertion expectation failed on an element that resolved in the DOM). The assertion preservation guard prohibits modifying assertions; findings are never auto-corrected.
- **`open -> needs_review`:** The page redirected to an unexpected URL before the assertion executed, leaving selectors looking for elements from the prior page (`backend/src/agent/staleExpectation.ts`).
- **`open -> gave_up`:** Reached when any of the following occur:
  - Mechanical failure persisted across 3 full execution rounds.
  - Job token budget was exceeded (`JOB_TOKEN_BUDGET`).
  - AST code safety checks rejected the code and correction could not produce safe code.
  - Test is a baseline check (built-in checks are never altered by the model).
- **`open -> open`:** A mechanical failure occurred (`locator`, `timeout`, or generic runner error), the current round is less than 3, and tokens remain. Corrected code is generated and submitted to the static type check for the next round.

---

## Architecture Decisions

| Decision | Why | Trade-off Accepted |
|---|---|---|
| [Observe-first grounding](#decision-1-observe-first-grounding) | Eliminates hallucinated selectors by cataloging DOM elements before planning, and grounds success assertions in observed page behavior. | Cannot test paths guarded behind interactions not discovered during crawl; success outcomes that were never observed cannot be asserted. |
| [Two-tier model separation](#decision-2-two-tier-model-separation) | Uses a high-capacity model for core scenario planning, a fast model for negative scenarios and locator repairs. | Requires coordinating two distinct model profiles and fallback pathways; dual-call planning costs more tokens than a single planning call. |
| [Plan caching](#decision-3-plan-caching) | Cuts median token consumption by ~85% on cache hits when re-testing stable URLs. | Cache hits reuse prior test structures until cache expiration or target changes. |
| [Static type-check gate](#decision-4-static-type-check-gate) | Blocks syntax and type errors from consuming browser execution time. | Adds 1–2 seconds of `tsc` overhead per validation round. |
| [Guarded round execution](#decision-5-guarded-round-execution) | Prevents the model from weakening assertions to artificially pass broken tests. | Tests that fail valid assertions cannot be auto-repaired and remain marked as failures. |
| [Built-in baseline checks](#decision-6-built-in-baseline-checks) | Injects smoke-1 (no uncaught JS errors) and smoke-2 (linked pages respond) without LLM calls. | A failing check classified as a finding stays failed; mechanical failures become gave_up; checks are never sent to corrector. |
| [Secret token substitution](#decision-7-secret-token-substitution) | Shields passwords and credentials from LLMs, databases, and logs. | Complex multi-stage credentials require manual mapping via the preview interface. |
| [In-process run queue](#decision-8-in-process-run-queue) | Eliminates Redis operational complexity for single-instance container hosting. | In-flight queue state does not persist across container restarts or horizontal scaling. |
| [Server-Sent Events](#decision-9-server-sent-events) | Delivers lightweight, unidirectional live job progress over standard HTTP. | Client cannot push data backward over the same stream (uses discrete REST endpoints). |
| [Postgres connection pooling](#decision-10-postgres-connection-pooling) | Operates reliably within Supabase free-tier connection limits using PgBouncer. | Direct connection required separately for migrations due to lack of advisory locks. |
| [Daily admission quotas](#decision-11-daily-admission-quotas) | Prevents upstream denial-of-service and API depletion on public deployments. | Legitimate heavy users must bring their own API keys once daily limits are reached. |
| [Target classification and wake handling](#decision-12-target-classification-and-wake-handling) | Handles sleeping free-tier host cold starts without failing the run immediately. | Initial runs on sleeping targets must wait for external spin-up delays. |
| [Free-tier deployment profile](#decision-13-free-tier-deployment-profile) | Enables hosting across Render, Vercel, Supabase, and Google Cloud Run free allocations. | Constrained to 512 MB RAM on Render, concurrency of 1, and scaled execution timeouts (`RUNNER_TIMEOUT_SCALE=2`). |
| [Multi-channel test export](#decision-14-multi-channel-test-export) | Provides immediately executable Playwright suites runnable in developer CI/CD. | Generated suites require installing Playwright dependencies in the target environment. |
| [Remote Chromium offload on Google Cloud Run](#decision-15-remote-chromium-offload-on-google-cloud-run-us-west1--why-not-render-or-browserless) | Offloads browser rendering to Google Cloud Run Always Free (`us-west1`), eliminating 512 MB cgroup OOMs and avoiding Browserless 120s session cutoffs. | Headless Chromium runs outside Render over WebSocket; outbound network egress capped at 1 GiB/mo free. |

<details>
<summary><strong>Expand All Architecture Decision Records</strong></summary>

### Decision 1: Observe-First Grounding

- **Context:** LLMs tasked with authoring browser tests from URLs or screenshots routinely hallucinate CSS classes, non-existent button texts, or deprecated IDs.
- **Decision:** Crawl the real DOM first with headless Chromium before engaging the planner model, then **observe** the crawled page to record grounded facts (navigation targets, popups, empty/filled form submits, repeated-item counts) as implemented in [backend/src/crawler/observe.ts](backend/src/crawler/observe.ts) and invoked during `runPipeline` in [backend/src/agent/pipeline.ts](backend/src/agent/pipeline.ts). Compile locators deterministically using strict preference ordering: `getByTestId` &rarr; `getByRole` &rarr; `getByPlaceholder` &rarr; `getByLabel` &rarr; `getByText` &rarr; CSS selector.
- **Why:** Deterministic mapping produces Playwright code that adheres to official testing best practices and aligns with actual page elements without model hallucination on the compiled path. Grounding rules force **success** assertions to be derived from observed facts, so a test cannot assert a success outcome (a post-submit URL, a hidden element, a reset field) that the observation run never produced. When `compileTest` throws `CompileError` (such as unresolvable element references), the pipeline falls back to the LLM generator (`generateTest`, origin `'llm'`) as implemented in [backend/src/agent/pipeline.ts](backend/src/agent/pipeline.ts).
- **Trade-off Accepted:** Dynamic elements that appear only after complex multi-step user interactions are not visible during the initial crawl, and paths the observation run did not exercise cannot be asserted as successes. Observing adds a dedicated browser pass (measured median ~11 s per run).
- **Where in Code:** `backend/src/crawler/pageCrawler.ts`, `backend/src/crawler/observe.ts`, `backend/src/agent/steps/compiler.ts` (`compileTest`), `backend/src/agent/pipeline.ts` (`runPipeline`).

### Decision 2: Two-Tier Model Separation

- **Context:** Running a high-parameter reasoning model for small locator syntax adjustments is inefficient and exhausts request limits, while a single planning call tends to blur core journeys and negative edge cases.
- **Decision:** Split LLM responsibilities into two tiers and use both during planning (**dual-call**): the high-reasoning tier (configured via environment variables `GROQ_REASONING_MODEL` / `GEMINI_REASONING_MODEL`) plans the **core** cases, and the fast low-latency tier (`GROQ_FAST_MODEL` / `GEMINI_FAST_MODEL`) plans the **negative** cases, with the two sides merged and capped at `MAX_AI_TEST_CASES` planned cases inside the `MAX_TEST_CASES` total ([backend/src/agent/run.config.ts](backend/src/agent/run.config.ts)). The fast tier also handles targeted locator repairs during correction. Route all calls through an ordered provider list (`LLM_PROVIDER_ORDER`, defaulting to `groq,gemini`) using standard `fetch` without vendor SDKs. When focus elements are supplied (via the `focus` field on `POST /api/generate`), or the dual-call token budget would be exceeded, the planner falls back to a single constrained call.
- **Why:** Separating core from negative planning raises journey coverage while keeping each prompt narrow; the fast tier minimizes latency and token consumption during error recovery.
- **Trade-off Accepted:** Prompts must be maintained and validated across multiple provider implementations, and dual-call planning consumes more tokens than a single planning call (measured: median fresh tokens 3,113 → 10,213 after introducing DOM observation and dual-call planning).
- **Where in Code:** `backend/src/agent/steps/planner.ts` (`planTests`), `backend/src/agent/run.config.ts`, `backend/src/config.ts`, `backend/src/llm/client.ts` (`callLlm`), `backend/src/llm/providers/openAiCompatible.ts`.

### Decision 3: Plan Caching

- **Context:** Re-testing the same application URL during continuous development generates identical crawl structures and prompts.
- **Decision:** Hash the plan-relevant inputs — the AppMap view, supplied test data, planning focus, and the observed facts (`buildPlanCacheKey`, [backend/src/agent/planCache.ts:14-28](backend/src/agent/planCache.ts#L14-L28)). On match, serve the previously synthesized scenario plan from memory while re-executing fresh compilation and browser runs. Entries expire after 6 hours (max 100 entries).
- **Why:** Measured results demonstrated an 85.5% median token reduction on cache hits (1,480 vs 10,213 tokens) while bypassing planner latency entirely.
- **Trade-off Accepted:** UI changes on the target URL that do not alter the top-level element structure reuse the cached scenario set until cache eviction or force-fresh execution.
- **Where in Code:** `backend/src/agent/planCache.ts`, `backend/src/agent/pipeline.ts`.

### Decision 4: Static Type-Check Gate

- **Context:** Generated TypeScript code may contain invalid variable references, broken Playwright imports, or bad syntax.
- **Decision:** Write generated tests to an isolated directory with an extended `tsconfig.json` and invoke `tsc --noEmit` before launching any browser process.
- **Why:** Failing fast on compiler errors avoids launching Chromium instances for broken code, saving CPU cycles and process overhead.
- **Trade-off Accepted:** Adds 1–2 seconds of TypeScript compilation time prior to browser launch.
- **Where in Code:** `backend/src/runner/validator.ts`.

### Decision 5: Guarded Round Execution

- **Context:** LLM correction loops frequently alter or delete failing assertions to force tests to pass, hiding real application bugs.
- **Decision:** AST checks verify that every assertion in the original code is structurally preserved in the corrected code (`assertionGuard.ts`). Any test where a locator resolved but the assertion failed is classified as a `finding` and immediately locked as `failed`.
- **Why:** Guarantees that automated correction only fixes mechanical harness issues (such as strict mode selector collisions) and never masks a regression.
- **Trade-off Accepted:** Tests that fail due to legitimate application defects cannot be automatically repaired to test subsequent steps.
- **Where in Code:** `backend/src/agent/rounds.ts`, `backend/src/agent/assertionGuard.ts`.

### Decision 6: Built-in Baseline Checks

- **Context:** Web applications share foundational quality requirements (clean runtime page execution and working links) that do not require generative planning.
- **Decision:** Inject deterministic baseline tests alongside AI-generated scenarios: `smoke-1` (no uncaught JavaScript errors on load) and `smoke-2` (linked pages respond). Label them distinctly in the UI as **Built-in check** versus **Generated scenario**.
- **Why:** Guarantees baseline regression coverage on every run even if LLM rate limits or token budgets are reached.
- **Trade-off Accepted:** A failing built-in check classified as a finding stays failed; mechanical failures become `gave_up`; built-in checks are never sent to the corrector.
- **Where in Code:** `backend/src/agent/baseline.ts:31-77`, `backend/src/agent/rounds.ts:330-348`, `frontend/components/job/TestResultCard.tsx:122,136`.

### Decision 7: Secret Token Substitution

- **Context:** End-to-end tests often require sensitive authentication credentials (passwords, tokens). Sending these to public LLMs or storing them in databases is a security hazard.
- **Decision:** Replace sensitive inputs with placeholder tokens (`__AGT_SECRET_1__`) in the prompt and database records. Inject real values only into the ephemeral test file on disk immediately before Playwright execution. Store browser credentials strictly in the user's browser `localStorage` (30-day TTL).
- **Why:** Zero credential exposure across LLM provider logs, server database records, and event streams.
- **Trade-off Accepted:** The user must enter credentials on the client preview interface prior to test generation.
- **Where in Code:** `backend/src/agent/testData.ts`, `backend/src/runner/executor.ts:212-217`, `frontend/lib/rememberedTestData.ts`.

### Decision 8: In-Process Run Queue

- **Context:** Distributed queues (e.g. BullMQ with Redis) introduce infrastructure overhead and operational complexity on free-tier hosting.
- **Decision:** Implement an in-memory run queue with a per-client claim token ensuring at most one active execution per visitor.
- **Why:** Zero operational dependencies beyond PostgreSQL; fits cleanly within free container environments.
- **Trade-off Accepted:** Queue state is in-memory; restarting the backend process drops queued jobs (though running jobs are marked failed on reboot via orphan reconciliation).
- **Where in Code:** `backend/src/agent/runQueue.ts`, `backend/src/maintenance/reconcileJobs.ts`.

### Decision 9: Server-Sent Events

- **Context:** Browser clients require real-time execution feedback (phase changes, live test completion, logs).
- **Decision:** Stream execution events over HTTP Server-Sent Events (`/api/jobs/:id/stream`) with a 15-second heartbeat ping and reconnect replay buffer. Proxy requests through Next.js rewrites with `no-transform` cache headers.
- **Why:** Works over standard HTTP/1.1 and HTTP/2 without WebSocket connection upgrades, corporate firewall blocks, or stateful socket servers.
- **Trade-off Accepted:** SSE is strictly unidirectional; client cancellations and actions must use standard HTTP POST requests.
- **Where in Code:** `backend/src/api/jobStream.ts`, `backend/src/agent/jobEvents.ts`, `frontend/next.config.js:8`.

### Decision 10: Postgres Connection Pooling

- **Context:** Free-tier PostgreSQL instances (such as Supabase) enforce strict connection ceilings (typically 15–20 direct connections).
- **Decision:** Route runtime application queries through Supabase's transaction pooler (PgBouncer on port 6543) with `connection_limit=1`. Restrict direct connections (port 5432) strictly to administrative migration commands (`prisma migrate deploy`).
- **Why:** Prevents connection starvation during bursts of crawler or runner queries.
- **Trade-off Accepted:** Advisory locks and prepared statements cannot be used in runtime application queries.
- **Where in Code:** `backend/prisma/schema.prisma:7-8`.

### Decision 11: Daily Admission Quotas

- **Context:** A public test generation service is vulnerable to automated scraping and denial-of-service that could rapidly exhaust upstream provider quotas.
- **Decision:** Enforce admission control using ALTCHA proof-of-work challenges, HMAC-signed visitor tokens, and strict daily execution budgets per visitor (8 runs) and per IP (20 runs). Disallow anonymous access once limits are reached unless the user provides their own API key (BYOK).
- **Why:** Protects hosting infrastructure and API quotas without requiring user registration or credit cards.
- **Trade-off Accepted:** Legitimate shared-IP users (such as corporate offices) may encounter IP caps sooner.
- **Where in Code:** `backend/src/security/dailyBudget.ts`, `backend/src/security/pow.ts`, `backend/src/api/visitorMiddleware.ts`.

### Decision 12: Target Classification and Wake Handling

- **Context:** Free cloud hosting providers (Render, Koyeb, Railway, Fly.io) put inactive applications to sleep, causing initial HTTP requests to take 30–60 seconds or return 502/503 status codes.
- **Decision:** Inspect navigation failures against known waking host suffixes and cold-start page signatures. When detected, classify the failure as `TARGET_WAKING`, emit a warning event, and instruct the client to wait with a 30-second `Retry-After` header.
- **Why:** Prevents marking sleeping web applications as broken, giving them time to spin up.
- **Trade-off Accepted:** Crawl requests for cold-started targets experience an intentional delay before testing begins.
- **Where in Code:** `backend/src/crawler/wakeDetect.ts`, `backend/src/crawler/gotoErrors.ts`, `backend/src/api/errors.ts:76`.

### Decision 13: Free-Tier Deployment Profile

- **Context:** The application is architected to operate indefinitely across free hosting tiers without incurring server infrastructure fees.
- **Decision:** Deploy Express backend to Render's free Docker tier (512 MB RAM, 0.1 CPU, `RUNNER_TIMEOUT_SCALE=2` matching `render.yaml`), frontend to Vercel, database to Supabase, and remote browser execution to Google Cloud Run (`us-west1` Always Free). Configure external UptimeRobot monitors to ping `/api/health` every 5 minutes (preventing Render container sleep) and `/api/health/db` every 12 hours (preventing database pausing).
- **Why:** Provides continuous availability and full end-to-end functionality without infrastructure spend.
- **Trade-off Accepted:** Render's free tier provides 750 free hours per month; keeping one service continuously awake consumes 744 hours (leaving 6 hours margin). Concurrency must be pinned to 1.
- **Where in Code:** `render.yaml`, `backend/Dockerfile`, `backend/src/config.ts`.

### Decision 14: Multi-Channel Test Export

- **Context:** Tests generated in a hosted browser tool are only valuable if engineering teams can easily integrate them into their development repositories.
- **Decision:** Provide an export endpoint that streams a zip archive containing individual `@playwright/test` specs, a `playwright.config.ts`, a `.env.example` mapping parameter secrets, and a ready-to-run GitHub Actions workflow (`.github/workflows/playwright.yml`).
- **Why:** Enables teams to run the generated test suite locally or inside CI/CD with a single command.
- **Trade-off Accepted:** Tests marked `needs_review` are excluded from the zip and listed in its README (`backend/src/export/projectExporter.ts:61-62,190-194`).
- **Where in Code:** `backend/src/export/projectExporter.ts`, `backend/src/api/jobsRoutes.ts:256`.

### Decision 15: Remote Chromium Offload on Google Cloud Run (`us-west1`) — Why Not Render or Browserless

- **Context:** Headless Chromium rendering full commercial SPAs alongside Node.js, `tsc --noEmit`, and `@playwright/test` runner processes routinely spikes memory consumption to 600–900 MB, far exceeding constrained container RAM limits.
- **Decision:** In hosted mode (`LOCAL_AGENT_MODE=false`), offload all Chromium browser contexts (Crawl, Observe, and Test Execution) over authenticated `wss://` to a dedicated Google Cloud Run service (`cloud-browser/`, `us-west1` Always Free, `2 vCPU / 2 GiB`, `min-instances=0`, `max-instances=1`, `concurrency=1`, `gen2`), with **zero local Chromium fallback** on failure. In local mode (`LOCAL_AGENT_MODE=true`), continue using local Chromium directly so developer workstation targets (`localhost` / `127.0.0.1`) function out of the box.
- **Live Flipkart Benchmark & Technical Rationale (`https://www.flipkart.com/`, 200 elements, 10 specs, `--trace on`):**
  1. **Why NOT Local Chromium on Render Free (`512 MB RAM / 0.1 CPU`) or a Second Render Service:**
     - **512 MB Cgroup OOM (`SIGKILL`):** Even after in-container memory and concurrency hardening (`--max-old-space-size=144` API, `112` runner, `HeavyOpGate(1)`, `EXECUTION_CHUNK_SIZE=3`, and blocking `image|media|font` during Crawl/Observe), live production testing on `flipkart.com` survived Crawl and Observe (`11.4s`) but triggered a kernel cgroup `SIGKILL` during Stage 4 execution when `chromium-headless-shell` rendered full commercial pages (unblocked CSS/images + `--trace on` DOM/network snapshots) alongside Node.
     - **Shared 750h/mo Workspace Ceiling:** Render's `750` free monthly hours are shared across the entire account workspace. Keeping the primary Express API awake 24/7 via UptimeRobot consumes `744 hours/month` (31-day month), leaving only `6 hours` margin — a second warm Render browser service would exhaust the quota mid-month while still suffering the same `512 MB` RAM ceiling.
  2. **Why NOT Browserless.io Free Tier (`1,000 units/month`, `120s` Hard Session Kill):**
     - Live benchmarked on `https://www.flipkart.com/`: **1 single job consumed `54 / 1,000` monthly units (`5.4%` -> cap of ~18 Flipkart jobs/month)**, took **`855.3s` (`14.25 min`)**, and **failed `8 / 10` specs as `gave_up` (`80%` infra failure)**.
     - Browserless Free enforces a hard **`120s` WebSocket session guillotine** on shared throttled CPU, severing every 3-spec traced chunk mid-flight, forcing 10 single-spec fallback retries, and timing out during `7.5 MB` `trace.zip` teardown transfers.
  3. **Why Google Cloud Run Always Free (`us-west1` Gen2, `2 vCPU / 2 GiB`, `min-instances=0`):**
     - On the identical Flipkart benchmark, `agt-playwright-ws` in `us-west1` (co-located with Render `oregon`) completed **4 / 4 3-spec chunks on the first try** (`77.3s`, `117.2s`, `86.9s`, `16.2s` — zero retries), achieved **`0 / 10` infra `gave_up` failures** (`5` passed + `5` deterministic assertion `finding`s), and consumed **`704.3 vCPU-s` (`0.39%` of the `180,000 vCPU-s/mo` Always Free allowance -> ~255 full Flipkart jobs/month, `14.1x` Browserless Free)** while removing Chromium completely from Render's `512 MB` container.
     - **Provider-Agnostic Wire Contract:** Both Cloud Run (`cloud-browser/server.mjs`) and Browserless speak native Playwright `1.63.0` over `BROWSER_WS_ENDPOINT` + `BROWSER_WS_TOKEN`; switching providers requires only environment-variable changes.
- **Trade-off Accepted:** Adds one additional Google Cloud Run deployment (`cloud-browser/`); outbound network egress is capped at GCP's permanent `1 GiB/month` free allowance (governed primarily by one-time `trace.zip` transfers from Cloud Run to Render).
- **Where in Code:** `backend/src/browser/remoteBrowser.ts`, `cloud-browser/server.mjs`, `cloud-browser/egressProxy.mjs`, `backend/src/runner/executor.ts`, `backend/playwright-runner/playwright.config.ts`.

</details>

---

## Security Model

```mermaid
flowchart TD
  subgraph RenderContainer ["1. Render Coordinator Container (node:22-bookworm-slim)"]
    A["Raw Generated / Corrected Code"] --> B["AST Safety Validator (codeSafety.ts)<br/>Rejects process, child_process, and forbidden APIs"]
    B -->|Pass| C["Isolated TypeScript Compiler<br/>tsc --noEmit with per-run scoped tsconfig"]
    C -->|Pass| D["Sanitized Child Environment (childEnv.ts)<br/>DATABASE_URL, secrets, and API keys stripped"]
    D --> E["Linux UID 1001 Isolation (isolation.ts)<br/>Backend UID 1000 node -> setpriv UID 1001 agtrunner"]
    E --> F["Node.js Network Guard (netGuard.mjs)<br/>Blocks all outbound TCP except allowlisted host:443"]
  end

  subgraph CloudRunContainer ["2. Google Cloud Run Service (cloud-browser/)"]
    F -->|Authenticated wss://?token=...| G["WebSocket Upgrade Auth (server.mjs)<br/>Constant-time timingSafeEqual SHA-256 token check"]
    G -->|Pass| H["Isolated chromium.launchServer<br/>Ephemeral profile, MAX_SESSION_MS=285s, reaped on disconnect"]
    H --> I["Connect-Time Egress Proxy (egressProxy.mjs)<br/>DNS-pinning SSRF protection blocking private & cloud metadata"]
    I --> J["Target Web Application"]
  end

  B -->|Forbidden AST construct| R1["Reject & Re-queue for Correction"]
  C -->|Type or Syntax Error| R2["Reject & Re-queue for Correction"]
  G -->|Invalid Token (401)| R3["Abort Connection Immediately"]
  I -->|Private IP / 169.254.169.254 (403)| R4["Reject Connection"]
```

### Defense-in-Depth Boundary

The AST static analysis check (`codeSafety.ts`) inspects the TypeScript syntax tree to reject known dangerous constructs: dynamic code evaluation (`eval`, `Function`), sensitive process globals (`process`, `globalThis`), network primitives (`fetch`, `WebSocket`), and access to object prototypes (`constructor`, `__proto__`). 

> [!NOTE]
> Static AST inspection is defense-in-depth, not an impregnable security boundary. Target web pages can attempt prompt-injection attacks to trick LLMs into generating obfuscated payloads. The true operational boundary is enforced at the OS, container, and network levels:
> 1. **Render Container Hardening:**
>    - The test runner executes as a dedicated unprivileged user (`agtrunner`, UID 1001) with zero Linux capabilities and `no_new_privs` enabled. Linux kernel permissions prevent UID 1001 from accessing backend process memory (`/proc/<pid>/mem`) or environment variables (`/proc/<pid>/environ`).
>    - Outbound TCP sockets created by the runner process are strictly intercepted by `netGuard.mjs`, allowing connections **only** to the designated remote browser endpoint (`AGT_REMOTE_BROWSER_ALLOW` `<host>:443`) in hosted mode, or the local egress proxy in local mode.
>    - All WebSocket tokens and secrets are scrubbed before child process spawning and sanitized from logs and error traces (`remoteBrowser.ts`, `childEnv.ts`, `sanitizeError.ts`, `logger.ts`).
> 2. **Cloud Run Remote Browser Hardening (`cloud-browser/`):**
>    - Dedicated non-privileged runtime service account (`agt-browser-sa`) with zero GCP IAM permissions.
>    - Constant-time SHA-256 `timingSafeEqual` token authentication on every HTTP `Upgrade` request to prevent timing attacks.
>    - Per-WebSocket isolated `chromium.launchServer` reaped immediately upon disconnect or hard 285s timeout.
>    - Outbound Chromium traffic is routed strictly through `egressProxy.mjs` with `--proxy-bypass-list=<-loopback>`, `--disable-quic`, and `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, verifying connect-time resolved IPs against RFC-1918, CGNAT, link-local, loopback (including container `:8080`), and cloud metadata (`169.254.169.254`, `metadata.google.internal`).

---

## Limits & Modes

### System Limits & Budgets

| Parameter | Default Value | Purpose | Source File |
|---|---|---|---|
| `GENERATE_DAILY_LIMIT` | `40` | Maximum total job generations allowed per day globally | `backend/src/config.ts:39` |
| `FREE_VISITOR_DAILY_LIMIT` | `8` | Maximum job generations allowed per visitor ID per day | `backend/src/config.ts:40` |
| `FREE_IP_DAILY_LIMIT` | `20` | Maximum job generations allowed per client IP per day | `backend/src/config.ts:41` |
| `FREE_MAX_URLS_PER_RUN` | `3` | Maximum URLs in a single run group for free users | `backend/src/config.ts:42` |
| `BYOK_MAX_URLS_PER_RUN` | `5` | Maximum URLs in a single run group for BYOK or local users | `backend/src/config.ts:43` |
| `CRAWL_DAILY_LIMIT_PER_IP` | `40` | Maximum crawl previews allowed per IP per day | `backend/src/config.ts:44` |
| `POW_DAILY_LIMIT_PER_IP` | `200` | Maximum proof-of-work challenges issued per IP per day | `backend/src/config.ts:45` |
| `BYOK_VALIDATE_DAILY_LIMIT_PER_IP` | `50` | Maximum BYOK key validation requests per IP per day | `backend/src/config.ts:46` |
| `PIPELINE_CONCURRENCY` | `1` | Simultaneous test generation pipelines executed | `backend/src/config.ts:47` |
| `QUEUE_MAX_WAITING_GROUPS` | `5` | Maximum queued runs waiting in the in-process queue | `backend/src/config.ts:48` |
| `MAX_AI_TEST_CASES` | `8` | Maximum AI-planned cases per run (inside the total cap) | `backend/src/agent/run.config.ts` |
| `MAX_TEST_CASES` | `12` | Maximum total test cases per run (AI + baseline) | `backend/src/agent/run.config.ts` |
| `JOB_TOKEN_BUDGET` | `40000` | Total token budget ceiling per test generation job | `backend/src/config.ts:56` |
| `MAX_ELEMENTS_PER_PAGE` | `200` | Maximum interactive DOM elements indexed per page | `backend/src/config.ts:21` |
| `NAVIGATION_TIMEOUT_MS` | `30000` | Browser navigation timeout during crawler indexing | `backend/src/config.ts:22` |
| `RUNNER_TIMEOUT_SCALE` | `1` (Render: `2`) | Multiplier for test execution timeouts on constrained CPUs | `backend/src/config.ts:57` |

### Cloud Infrastructure & Google Cloud Run Always-Free Limits

The remote browser offload operates strictly within Google Cloud Run's permanent (post-90-day trial) Always Free tier:

| Cloud Resource / Quota | Always Free Allowance | Service Configuration & Consumption | Governing Cap & Headroom |
|---|---|---|---|
| **Region & Instance Profile** | Tier 1 region (`us-west1` Oregon) | `gen2`, `2 vCPU`, `2 GiB RAM`, `cpu-throttling=true`, `min-instances=0`, `max-instances=1`, `concurrency=1`, `timeout=300s` (`MAX_SESSION_MS=285s`), zero-IAM SA | CPU billed strictly during active WebSocket connections; `$0 / ₹0` at idle. Scale-to-zero occurs ~15s after socket close. |
| **Compute CPU Time** | `180,000 vCPU-seconds / month` | Billed as `active_seconds * 2 vCPU`. Heavy Flipkart e-commerce benchmark consumed `704.3 vCPU-s` (~`352s` active time). | **~255 heavy e-commerce jobs/month** or **~600–900 typical SPA jobs/month** (~25 active hours of 2 vCPU allocation). |
| **Compute Memory Allocation** | `360,000 GiB-seconds / month` | Billed as `active_seconds * 2 GiB`. | 50 active hours of 2 GiB RAM allocation, comfortably exceeding CPU headroom. |
| **Invocations / Requests** | `2,000,000 requests / month` | Each WebSocket connection counts as 1 HTTP upgrade request. | Negligible (~hundreds of requests/month vs 2M allowance). |
| **Outbound Network Egress** | **`1 GiB` (`1,024 MB`) / month** | North America outbound (`us-west1` -> Render `oregon`). Governed by one-time `trace.zip` streaming at teardown (~`3–5 MB` typical SPA, ~`25–35 MB` media-heavy e-commerce). | **Primary governing cap:** ~`200–300` typical jobs/month or ~`30–40` media-heavy jobs/month. Subsequent trace replays/downloads serve from Render's `.traces/` cache (`100 GB/mo` free bandwidth) at $0 GCP cost. |
| **Artifact Registry Storage** | **`0.5 GB` (`500 MB`) / month** | Minimal Debian Bookworm image installing `chromium-headless-shell` only: **`~425 MiB` (`445.8 MB`)**. | Strictly keep **1 active image digest** in `us-west1-docker.pkg.dev`; delete superseded digests after redeployment. |
| **Cloud Build & Source Staging** | `2,500 build-minutes / month`, `5 GB-mo` Standard Cloud Storage | Build takes ~`120 seconds` (~5% of 1 month's free build minutes). Source archive `< 50 KB`. | Staging storage consumes `< 0.001%` of monthly free storage quota. |

### Execution Modes

| Mode | Target Reachability | Admission Requirements | Intended Environment |
|---|---|---|---|
| **Hosted Mode** | Public internet targets only. Private IPs and localhost blocked by `netPolicy.ts`. | ALTCHA proof-of-work required. Daily IP and visitor limits enforced. | Public production deployments (Vercel + Render + Cloud Run). |
| **Tunnel Mode** | Localhost and private targets exposed via secure tunnel (e.g. `ngrok` or `cloudflared`). | Standard hosted mode rules apply; tunnel hostname treated as public target. | Testing local developer servers from hosted deployment. |
| **Local Agent Mode** | Direct access to `localhost`, `127.0.0.1`, and private intranet subnets. | All admission limits, quotas, and proof-of-work checks disabled. | Local workstation development (`LOCAL_AGENT_MODE=true`). |

---

## Measured Results

Measurements recorded from a live 12-run verification matrix re-run after introducing DOM observation and dual-call planning (Observe step + dual-call planning + success-only grounding):

- **Commit:** `2563338`
- **Date:** October 21, 2026
- **Configuration:** `LOCAL_AGENT_MODE=false` (egress proxy enabled), `BASELINE_TESTS=true`, `JOB_TOKEN_BUDGET=40000` (one run capped at `8000`), harness run under `MEASURE=1`. `A11Y_SMOKE`/`smoke-3` no longer exist in the product and were not used.

| Metric | Measured Value | Notes |
|---|---|---|
| Total Runs Executed | 12 | Same matrix as the baseline (TodoMVC, the-internet, saucedemo, practicetestautomation); 1 run failed at planning with 0 tests |
| AI Scenarios Planned | 72 | Synthesized by the dual-call planner (reasoning core + fast negative) |
| Baseline Checks Injected | 15 | Built-in smoke tests (smoke-1: no uncaught JavaScript errors on load; smoke-2: linked pages respond) |
| Total Tests Evaluated | 87 | Combined test suite execution |
| Tests Passing | 69 (79.3%) | Tests completing without failure |
| Reported Findings | 9 (10.3%) | Potential defects flagged to user |
| Tests Gave Up | 9 (10.3%) | Exhausted attempts, token limits, or unrecoverable locators |
| Repaired by Correction Loop | 3 | Strict-mode locator disambiguation (all on TodoMVC) |
| Median Fresh Run Tokens | 10,213 | Median token count without plan cache (n=11) |
| Median Cached Run Tokens | 1,480 | 85.5% reduction in token consumption on cache hit |
| Median Wall Time | 70.1s | Across crawl, observe, plan, compile, execution, and triage |
| Median Observe Step Latency | 11.2s | Dedicated DOM observation step (per-run range 5.7–22.7s) |

**Previous measurement (`c89620e`, prior single-pass planner baseline):** pass rate 66.7% (56/84), false-finding rate 100% (20/20), median fresh tokens 3,113, median wall time 62.8s.

> [!WARNING]
> **Known Pipeline Limitations Identified During Measurement**
> 1. **False-finding rate unchanged at 100% of reported findings:** In the 12-run measurement, all 9 reported findings (plus 1 `gave_up`) were test bugs rather than genuine target defects — no genuine defect was detected in any run. The *volume* of findings more than halved (20 → 9) and pass rate rose (66.7% → 79.3%), but the *rate* did not move. Observe-first grounding only guards **success** assertions; the remaining false findings come from the fast/negative tier — 5 negatives inject valid test-data credentials and then assert the login must fail, and 4 assert unobserved post-submit state changes (a field resets, an element becomes hidden).
> 2. **Low Correction Success Rate (30.0% attempt success):** The correction loop succeeded in 3 of 10 attempts (3 of 8 multi-attempt tests), all strict-mode locator disambiguation on TodoMVC. Every attempt on role-based login locators (the-internet/saucedemo/practicetestautomation) exhausted its retries.
> 3. **Planning cost and reliability:** Dual-call planning roughly tripled median fresh tokens (3,113 → 10,213) and nearly doubled LLM calls per run (1.8 → 3.4), and added a dedicated ~11 s observe phase. One run (Run 4) produced zero tests because both dual-call sides and the self-repair call failed output-schema validation.
> 4. Negating the fast/negative tier (never inject valid credentials into a "must fail" case; never assert an unobserved state change) and supplying navigation-aware correction guidance are the central objectives of the next tuning phase.

---

## Run Locally

### Prerequisites

- **Node.js:** Node 22 (Docker image `node:22-bookworm-slim`); tested on `v24.14.1`
- **Package Manager:** `pnpm` (version 10.x, matching `corepack prepare pnpm@10` in `backend/Dockerfile`)
- **Database:** PostgreSQL database instance (local PostgreSQL or Supabase project)
- **LLM API Key:** At least one API key from Groq or Google Gemini

### Setup Instructions (PowerShell)

```powershell
# 1. Clone repository and navigate to root
git clone https://github.com/vansh412f/agentic-test-case-generator.git
cd agentic-test-case-generator

# 2. Configure Backend
cd backend
Copy-Item .env.example .env

# Edit .env with your credentials:
# DATABASE_URL, DIRECT_URL, and at least one LLM key (GROQ_API_KEY)
# For local use without quotas, set LOCAL_AGENT_MODE=true

pnpm install
pnpm exec prisma migrate deploy
pnpm exec playwright install chromium
cd ..

# 3. Configure Frontend
cd frontend
Copy-Item .env.example .env.local
pnpm install
cd ..

# 4. Start Services in Separate Terminals
# Terminal 1 (Backend on http://localhost:4000):
cd backend
pnpm dev

# Terminal 2 (Frontend on http://localhost:3000):
cd frontend
pnpm dev
```

<details>
<summary><strong>Bash Setup Instructions (Linux / macOS)</strong></summary>

```bash
# 1. Clone repository and enter directory
git clone https://github.com/vansh412f/agentic-test-case-generator.git
cd agentic-test-case-generator

# 2. Configure Backend
cd backend
cp .env.example .env

# Set DATABASE_URL, DIRECT_URL, GROQ_API_KEY, and LOCAL_AGENT_MODE=true in .env
pnpm install
pnpm exec prisma migrate deploy
pnpm exec playwright install chromium
cd ..

# 3. Configure Frontend
cd frontend
cp .env.example .env.local
pnpm install
cd ..

# 4. Start Development Servers
# Terminal 1:
cd backend && pnpm dev

# Terminal 2:
cd frontend && pnpm dev
```

</details>

---

## Configuration

<details>
<summary><strong>Backend Environment Variables (backend/src/config.ts)</strong></summary>

| Variable Name | Default Value | Required in Production? | Purpose |
|---|---|---|---|
| `PORT` | `4000` | No | Port on which the Express server listens |
| `NODE_ENV` | `development` | Yes (`production`) | Application environment (`development`, `production`, `test`) |
| `LOG_LEVEL` | `info` (prod) / `debug` (dev) | No | Winston structured logging severity level (`error`, `warn`, `info`, `debug`) |
| `HEADED_DEBUG` | `false` | No | When true in dev, launches visible browser windows for debugging |
| `CRAWL_CONCURRENCY` | `1` | No | Concurrent crawler browser contexts (1–4) |
| `MAX_ELEMENTS_PER_PAGE` | `200` | No | Maximum interactive elements indexed during crawl |
| `NAVIGATION_TIMEOUT_MS` | `30000` | No | Page navigation timeout in milliseconds |
| `NETWORK_IDLE_WAIT_MS` | `3000` | No | Network quiescence wait time after page navigation |
| `DATABASE_URL` | *(none)* | Yes | Pooled PostgreSQL connection string (PgBouncer port 6543) |
| `DIRECT_URL` | *(none)* | Yes | Direct PostgreSQL connection string for migrations (port 5432) |
| `GROQ_API_KEY` | *(none)* | Yes (or Gemini) | Groq API authentication key |
| `GEMINI_API_KEY` | *(none)* | Optional fallback | Google Gemini API authentication key |
| `GROQ_REASONING_MODELS` | `openai/gpt-oss-120b` | No | Comma-separated fallback chain for Groq reasoning (planner core, expansion, repair) |
| `GROQ_FAST_MODELS` | `openai/gpt-oss-20b,qwen/qwen3.8-27b` | No | Comma-separated fallback chain for Groq fast tier (planner negative, generator, corrector) |
| `GEMINI_REASONING_MODELS` | `gemini-3.5-flash,gemini-2.5-flash` | No | Comma-separated fallback chain for Gemini reasoning |
| `GEMINI_FAST_MODELS` | `gemini-3.1-flash-lite,gemini-3.5-flash-lite` | No | Comma-separated fallback chain for Gemini fast tier |
| `GROQ_REASONING_MODEL` | `openai/gpt-oss-120b` | No | Primary reasoning model on Groq (backward-compatible override) |
| `GROQ_FAST_MODEL` | `openai/gpt-oss-20b` | No | Primary fast model on Groq (backward-compatible override) |
| `GEMINI_REASONING_MODEL` | `gemini-3.5-flash` | No | Primary reasoning model on Gemini (backward-compatible override) |
| `GEMINI_FAST_MODEL` | `gemini-3.1-flash-lite` | No | Primary fast model on Gemini (backward-compatible override) |
| `LLM_PROVIDER_ORDER` | `groq,gemini` | No | Ordered fallback sequence for LLM provider attempts. Traversal rule: Provider order first (`LLM_PROVIDER_ORDER`). Within a provider, fallback to the next model in the chain occurs ONLY on `MODEL_UNAVAILABLE` (404/decommissioned). All other errors (auth failure, bad response, rate limit > 10s, retry exhaustion) immediately advance to the next provider. |
| `POW_SECRET` | *(none)* | Yes (&ge;16 chars) | HMAC signing secret for ALTCHA proof-of-work challenges |
| `VISITOR_SIGNING_SECRET` | *(none)* | Yes (&ge;16 chars) | HMAC signing secret for anonymous visitor session tokens |
| `ADMIN_SECRET` | *(none)* | Yes (&ge;24 chars) | Shared secret required in `X-Admin-Secret` header for admin routes |
| `EDGE_SHARED_SECRET` | *(none)* | Yes (&ge;24 chars) | Shared secret validating incoming Vercel edge rewrite proxy headers |
| `GENERATE_DAILY_LIMIT` | `40` | No | Global daily ceiling for test generation jobs |
| `FREE_VISITOR_DAILY_LIMIT` | `8` | No | Daily generation limit per anonymous visitor |
| `FREE_IP_DAILY_LIMIT` | `20` | No | Daily generation limit per client IP |
| `FREE_MAX_URLS_PER_RUN` | `3` | No | Maximum URLs per run group for free anonymous users |
| `BYOK_MAX_URLS_PER_RUN` | `5` | No | Maximum URLs per run group for BYOK or local agent runs |
| `CRAWL_DAILY_LIMIT_PER_IP` | `40` | No | Daily limit for `/api/crawl` requests per IP |
| `POW_DAILY_LIMIT_PER_IP` | `200` | No | Daily limit for proof-of-work challenge requests per IP |
| `BYOK_VALIDATE_DAILY_LIMIT_PER_IP` | `50` | No | Daily limit for API key pre-flight checks per IP |
| `PIPELINE_CONCURRENCY` | `1` | No | Maximum concurrent test execution pipelines (1–4) |
| `QUEUE_MAX_WAITING_GROUPS` | `5` | No | Maximum pending run groups allowed in memory queue |
| `BASELINE_TESTS` | `true` | No | When true, injects smoke-1 (no uncaught JavaScript errors on load) and smoke-2 (linked pages respond) |
| `WAKING_HOST_SUFFIXES` | `onrender.com,...` | No | Comma-separated host suffixes subject to cold start detection |
| `LOCAL_AGENT_MODE` | `false` | Fatal if true in prod | Disables quotas, admission checks, and private IP blocks |
| `TRUST_PROXY_HOPS` | `1` | No | Number of upstream reverse proxy hops to trust for IP extraction |
| `FRONTEND_ORIGIN` | *(none)* | Yes | Allowed frontend origin URLs for CORS (comma-separated) |
| `JOB_TOKEN_BUDGET` | `40000` | No | Maximum prompt and completion tokens consumed per job |
| `RUNNER_TIMEOUT_SCALE` | `1` | No (Render: `2`) | Multiplier scaling Playwright timeouts for low-CPU hosts |
| `RUNNER_ISOLATION` | `none` | Yes (`uid`) | Runner isolation model (`none` for dev, `uid` for prod) |
| `RUNNER_UID` | `1001` | No | Linux UID assigned to unprivileged runner process |
| `RUNNER_GID` | `1002` | No | Linux GID assigned to unprivileged runner process |
| `BROWSER_WS_ENDPOINT` | *(none)* | Optional (Required for remote Cloud Run) | Remote Playwright WebSocket endpoint (`wss://<service>.a.run.app/chromium/playwright`). Bypassed when `LOCAL_AGENT_MODE=true`. |
| `BROWSER_WS_TOKEN` | *(none)* | Yes if endpoint set | Authentication token for remote Playwright WebSocket (min 24 chars, 32+ recommended) |
| `CORS_PREVIEW_ORIGIN_REGEX` | *(none)* | No | Regular expression pattern for dynamically allowed preview origins |

</details>

<details>
<summary><strong>Frontend Environment Variables (frontend/.env.example)</strong></summary>

| Variable Name | Default Value | Purpose |
|---|---|---|
| `BACKEND_URL` | `http://localhost:4000` | Destination address for Next.js API route rewrites |
| `EDGE_SHARED_SECRET` | *(none)* | Secret sent in `x-agt-edge-secret` header to backend |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Canonical public URL used for metadata and OpenGraph tags |
| `NEXT_PUBLIC_DEPLOYMENT_MODE` | `local` | Fallback mode indicator (`local` or `hosted`) |
| `NEXT_PUBLIC_STREAM_ORIGIN` | *(none)* | Optional direct backend URL for SSE streams |
| `NEXT_PUBLIC_GA_ID` | *(none)* | Optional Google Analytics measurement ID |
| `NEXT_PUBLIC_GSC_VERIFICATION` | *(none)* | Optional Google Search Console HTML verification string |

</details>

---

## API Reference

<details>
<summary><strong>Complete Route Catalog & SSE Event Specification</strong></summary>

### Public Application Endpoints

| Method | Route | Description | Key Parameters | Error Codes |
|---|---|---|---|---|
| `GET` | `/api/health` | Uptime and mode health check | None | None |
| `GET` | `/api/health/db` | Supabase keep-alive ping (cached 10 min) | None | `503 SERVICE_UNAVAILABLE` |
| `GET` | `/api/stats` | Aggregated lifetime metrics | None | `INTERNAL_ERROR` |
| `GET` | `/api/pow/challenge` | Generates ALTCHA proof-of-work challenge | None | `INTERNAL_ERROR` |
| `POST` | `/api/crawl` | Previews target URL and returns AppMap | `{ url }` | `INVALID_URL`, `TARGET_UNREACHABLE`, `QUEUE_FULL` |
| `POST` | `/api/byok/validate` | Validates custom Groq or Gemini API keys | `{ provider }` + Key Header | `INVALID_REQUEST` |
| `GET` | `/api/budget` | Retrieves remaining daily runs for visitor/IP | None | None |
| `POST` | `/api/generate` | Enqueues scenario planning and test execution | `{ url, urls?, testData?, altcha? }` | `DAILY_QUOTA_EXHAUSTED`, `POW_FAILED`, `QUEUE_FULL`, `TOO_MANY_URLS` |

### Job Management Endpoints

| Method | Route | Description | Key Parameters | Error Codes |
|---|---|---|---|---|
| `GET` | `/api/jobs` | Lists historical jobs for current visitor | Query: `page`, `limit` | `INVALID_REQUEST` |
| `GET` | `/api/jobs/:id` | Returns full status and test detail for a job | Param: `id` (UUID) | `JOB_NOT_FOUND` |
| `GET` | `/api/jobs/:id/appmap` | Returns crawled AppMap for a job | Param: `id` (UUID) | `JOB_NOT_FOUND` |
| `POST` | `/api/jobs/:id/cancel` | Cancels an in-flight job or run group | Body: `{ scope: 'job' \| 'group' }` | `NOT_CANCELLABLE`, `JOB_NOT_FOUND` |
| `GET` | `/api/jobs/:id/stream` | Server-Sent Events live execution stream | Param: `id`, Header: `Last-Event-ID` | `JOB_NOT_FOUND` |
| `GET` | `/api/jobs/:id/report.html` | Generates standalone HTML run report | Param: `id` (UUID) | `REPORT_NOT_READY`, `JOB_NOT_FOUND` |
| `GET` | `/api/jobs/:id/export.zip` | Downloads runnable Playwright project zip | Param: `id` (UUID) | `NO_EXPORTABLE_TESTS`, `JOB_NOT_FOUND` |
| `GET` | `/api/jobs/:id/tests/:testCaseId/trace` | Returns signed, short-lived trace links for all execution attempts | Param: `id`, `testCaseId`, Query: `attempt?` | `JOB_NOT_FOUND` |
| `GET` | `/api/traces/:traceId` | Serves an owner-only Playwright trace zip given its signed token | Param: `traceId`, Query: `t` | `TRACE_NOT_FOUND` |

### Administrative Endpoints (Requires `X-Admin-Secret`)

| Method | Route | Description | Key Parameters | Error Codes |
|---|---|---|---|---|
| `GET` | `/api/admin/events` | Inspects recent server events and errors | Query: `level`, `since`, `limit` | `404 NOT_FOUND` (if unauthenticated) |
| `GET` | `/api/admin/whoami` | Displays resolved IP address and proxy hops | None | `404 NOT_FOUND` (if unauthenticated) |

### Server-Sent Events Specification (`/api/jobs/:id/stream`)

The SSE connection transmits continuous UTF-8 event text with an automatic 15-second heartbeat (`: ping\n\n`) and client reconnection backoff (`retry: 3000\n\n`). Events emitted:

- `snapshot`: Sent on initial connection with current job status and error codes.
- `phase_change`: Emitted when the pipeline advances (`crawling`, `planning`, `generating`, `executing`, `completed`, `failed`, `cancelled`).
- `step_recorded`: Emitted when individual pipeline steps finish (e.g. `validate`, `execute`, `crawl`).
- `test_completed`: Emitted whenever a single test case reaches terminal status (`passed`, `failed`, `gave_up`, `needs_review`).
- `queue_position`: Emitted when queued waiting for pipeline concurrency slots.
- `target_waking`: Emitted when a sleeping free host is detected, with `nextRetryInSec`.
- `budget_note`: Emitted when token budget is reached and correction stops.
- `job_finished`: Final event closing the SSE stream.
- `unavailable`: Emitted if the job process channel is no longer active in memory, prompting client fallback to REST polling.

</details>

---

## Database Schema

Database entities are managed via Prisma (`backend/prisma/schema.prisma`) and hosted on Supabase PostgreSQL:

```mermaid
erDiagram
  Job ||--o{ AgentStep : "records (Cascade)"
  Job ||--o{ GeneratedTest : "produces (Cascade)"
  GeneratedTest ||--o{ ExecutionResult : "attempts (Cascade)"

  Job {
    uuid id PK
    string targetUrl
    JobStatus status "pending|crawling|planning|generating|executing|completed|failed|cancelled"
    string errorCode "nullable"
    string errorMessage "nullable"
    json appMap "nullable"
    json testPlan "nullable"
    datetime createdAt "default now"
    datetime startedAt "nullable"
    datetime completedAt "nullable"
    string visitorId "nullable"
    boolean usedOwnKeys "default false"
    boolean quotaExempt "default false"
    uuid runGroupId "nullable"
    string ipHash "nullable"
    datetime cancelledAt "nullable"
  }

  AgentStep {
    uuid id PK
    uuid jobId FK "references Job.id"
    StepType stepType "crawl|observe|plan|generate|validate|execute|correct"
    string testCaseId "nullable"
    int attemptNumber "nullable"
    StepStatus status "success|failure"
    int latencyMs "nullable"
    string llmProvider "nullable"
    string llmModel "nullable"
    int promptTokens "nullable"
    int completionTokens "nullable"
    string errorDetail "nullable"
    datetime createdAt "default now"
  }

  GeneratedTest {
    uuid id PK
    uuid jobId FK "references Job.id"
    string testCaseId
    string filename
    string finalCode
    TestStatus finalStatus "passed|failed|gave_up|needs_review"
    int totalAttempts
    datetime createdAt "default now"
  }

  ExecutionResult {
    uuid id PK
    uuid generatedTestId FK "references GeneratedTest.id"
    int attemptNumber
    string code
    boolean validationPassed
    json validationErrors "nullable"
    boolean executionPassed "nullable"
    string executionError "nullable"
    FailureClass failureClass "finding|locator|timeout|other"
    json failureContext "nullable"
    int durationMs "nullable"
    boolean corrected
    datetime createdAt "default now"
  }

  ServerEvent {
    uuid id PK
    datetime createdAt "default now"
    string level "warn|error"
    string source
    string message "VarChar(500)"
    json context "nullable"
    uuid jobId "nullable unconstrained (not a Prisma relation)"
    string fingerprint
    int count "default 1"
  }
```

### Relations, Cascades & Constraints
- **Cascade Deletions:** `Job` configures `onDelete: Cascade` to both `AgentStep` and `GeneratedTest`. `GeneratedTest` configures `onDelete: Cascade` to `ExecutionResult`. Expiry sweeps or manual job deletions cleanly purge all child steps and test results.
- **Unique Constraints:**
  - `GeneratedTest`: `@@unique([jobId, testCaseId])` and `@@unique([jobId, filename])` prevent duplicate case collisions.
  - `ExecutionResult`: `@@unique([generatedTestId, attemptNumber])` prevents duplicate attempt records.
- **Indexes:**
  - `Job`: `[createdAt, id]`, `[visitorId, createdAt]`, `[ipHash, createdAt]`, `[runGroupId]`.
  - `AgentStep`: `[jobId]`.
  - `GeneratedTest`: `[jobId]`.
  - `ExecutionResult`: `[generatedTestId]`.
  - `ServerEvent`: `[createdAt]`.
- **ServerEvent Decoupling:** `ServerEvent.jobId` is an unconstrained UUID column and **not a Prisma relation**. This allows system events and errors to be recorded even when a job is rejected before creation or after a job record is purged.

---

## Storage & State Matrix

| Storage Layer | Technology / Location | State Maintained | Lifecycle / Retention Policy | Security & Isolation Model |
|---|---|---|---|---|
| **Persistent Relational DB** | Supabase PostgreSQL (PgBouncer `:6543`) | Jobs, agent steps, test plans, generated test code, execution results, server events | Retained indefinitely (no automatic expiry); manual removal on request | SSL required; secrets replaced with `__AGT_SECRET_n__` tokens |
| **Ephemeral Disk Storage** | Render Backend Container (`.traces/`, `tests/run-*`) | Playwright trace zips, temporary execution files and test specs | Max 200 traces, 256 MiB total cap, 25 MiB single trace limit, FIFO eviction by `createdAt`, 1-hour TTL; run dirs deleted on run completion | Traces served only via HMAC-signed 10-minute owner tokens; runner sandboxed under UID 1001 |
| **Remote Browser Runtime** | Google Cloud Run (`us-west1` Always Free) | Ephemeral Chromium browser contexts, active tabs, `/tmp` session storage | Destroyed immediately on WebSocket disconnect; service scales to zero ~15s after socket teardown | Zero-IAM SA (`agt-browser-sa`), SHA-256 token upgrade authentication, connect-time DNS pinning egress proxy |
| **In-Memory Backend State** | Node.js Process Memory | In-flight run queue, active SSE connection listeners, plan cache (keyed by normalized URL + element hash), ALTCHA replay cache (10 min TTL), visitor token-bucket budget reservations | Process lifetime; caches have explicit TTLs (plan cache: 6 hours / 100 entries); cleared on container restart | In-memory only; non-shared across instances |
| **Browser Client Storage** | Browser `localStorage` & `sessionStorage` | Prefill test credentials (30 days in `localStorage`, user-consented), active visitor ID (`agt_visitor_id`), active run history | Client-controlled; deleted on browser clear; never transmitted except in user request payloads | Strictly client-side domain storage |
| **External Model APIs** | Groq & Google Gemini APIs | Transient LLM inference prompts and completions | No server-side retention; API keys sent via HTTPS authorization headers | Server keys or user BYOK; sensitive data redacted in logging |

---

## Observability & Structured Logging

The backend observability stack combines structured Winston logging for runtime inspection on Render with in-database event deduplication for operational alerts:

1. **Winston Structured Logger ([backend/src/observability/logger.ts](backend/src/observability/logger.ts)):**
   - **Console Transport Only:** Directly streams logs to container `stdout`/`stderr` without local file overhead.
   - **Production JSON Formatting:** In production (`NODE_ENV=production`), logs format as single-line JSON structured for Render log search and metric extraction. In development, logs use colorized human-readable tags.
   - **Configurable Severity:** Governed by `LOG_LEVEL` (defaults to `info` in production, `debug` in development).
   - **Context Enrichment:** Emits standard context fields including `component`, `jobId`, `provider`, `model`, `latencyMs`, `promptTokens`, `completionTokens`, and `errorCode`.
   - **Automatic Secret Redaction:** Recursively redacts Bearer tokens, Groq API keys (`gsk_*`), Gemini API keys (`AIzaSy*`), PostgreSQL connection strings, signed trace tokens (`t=*`), URL token query parameters (`?token=*`), `browser_ws_token`, `edge_shared_secret`, and sensitive request body fields before log emission.
2. **ServerEvent Deduplication ([backend/src/observability/serverEvents.ts](backend/src/observability/serverEvents.ts)):**
   - Captures unhandled promise rejections, uncaught exceptions, and LLM exhaustion events in the `ServerEvent` table.
   - Deduplicates identical errors using an SHA-256 fingerprint within a sliding 60-second window, incrementing an event `count` instead of creating redundant rows.

---

## Project Structure

<details>
<summary><strong>Repository Directory Tree</strong></summary>

```text
.
├── backend/                        # Express API & test generation engine
│   ├── Dockerfile                  # Multi-stage production container with UID isolation
│   ├── docker-entrypoint.sh        # Container entrypoint configuring node capabilities
│   ├── package.json                # Express 5, Prisma 6, Playwright 1.63 dependencies
│   ├── playwright-runner/          # Sandboxed runner package executed by Playwright CLI
│   │   ├── agt-capture.ts          # Playwright test fixture capturing page navigations
│   │   ├── netGuard.mjs            # In-process monkeypatch restricting child TCP egress
│   │   ├── playwright.config.ts    # Config mapping wsEndpoint to remote Cloud Run browser
│   │   └── package.json            # Dedicated runner dependencies
│   ├── prisma/                     # Database schema definition & migration history
│   │   ├── migrations/             # Timestamped SQL migrations
│   │   └── schema.prisma           # Prisma schema definition
│   ├── scratch/                    # Verification test scripts and measurement harnesses
│   └── src/
│       ├── agent/                  # Core pipeline coordination and round execution
│       │   ├── assertionGuard.ts   # AST assertion-preservation validator
│       │   ├── baseline.ts         # Deterministic broken-link baseline tests
│       │   ├── pipeline.ts         # End-to-end job orchestration loop
│       │   ├── plannerView.ts      # Element projection with compactHref tracking-URL pruning
│       │   ├── rounds.ts           # Execution round coordinator and failure classifier
│       │   ├── runQueue.ts         # In-process FIFO queue with concurrency gates
│       │   └── steps/              # Pipeline steps: compiler, corrector, planner
│       ├── api/                    # Express routing, input schemas, and SSE handlers
│       │   ├── jobsRoutes.ts       # Job status, cancellation, reports, and streaming
│       │   ├── routes.ts           # Generation admission, crawl previews, and budget
│       │   └── schemas.ts          # Zod request validation schemas
│       ├── browser/                # Remote Playwright browser configuration & URL builders
│       │   └── remoteBrowser.ts    # WebSocket URL formatting, token auth & no-fallback guards
│       ├── config.ts               # Centralized Zod-validated environment configuration
│       ├── crawler/                # Playwright DOM scraping and element cataloging
│       │   ├── gotoErrors.ts       # Navigation error taxonomy mapping
│       │   ├── observe.ts          # Grounded-fact observation (nav/popup/form/count)
│       │   ├── pageCrawler.ts      # Headless DOM extraction and semantic role builder
│       │   └── wakeDetect.ts       # Sleeping target host detection heuristics
│       ├── db/                     # Prisma database client and query helpers
│       ├── export/                 # Project zip packing and GitHub Actions generator
│       ├── llm/                    # Zero-SDK OpenAI-compatible fetch clients and BYOK
│       ├── observability/          # Deduplicated server event error recording & logger
│       ├── report/                 # Standalone single-file HTML report generator
│       ├── runner/                 # Playwright execution, tsc validation, and isolation
│       │   ├── childEnv.ts         # Child process environment sanitizer with token scrubbing
│       │   ├── codeSafety.ts       # AST inspection rejecting forbidden JavaScript APIs
│       │   ├── executor.ts         # Playwright test process execution harness
│       │   ├── isolation.ts        # Linux setpriv UID/GID process sandboxing
│       │   ├── traceStore.ts       # Ephemeral trace zip storage & access token signer
│       │   └── validator.ts        # Static TypeScript type-checking gate
│       └── security/               # Admission control, ALTCHA PoW, and network policy
│           ├── dailyBudget.ts      # Atomic daily IP and visitor usage tracking
│           ├── egressProxy.ts      # Connect-time DNS validation HTTP proxy
│           ├── netPolicy.ts        # IP subnet blocking preventing SSRF attacks
│           └── pow.ts              # ALTCHA proof-of-work challenge verification
├── cloud-browser/                  # Google Cloud Run remote browser microservice
│   ├── Dockerfile                  # Minimal Debian Bookworm container (chromium-headless-shell only, ~425 MiB)
│   ├── egressProxy.mjs             # Connect-time DNS-pinning SSRF protection HTTP proxy
│   ├── package.json                # Lightweight dependencies (ws, playwright-core)
│   └── server.mjs                  # WebSocket auth multiplexer and chromium.launchServer lifecycle
├── frontend/                       # Next.js 14 Pages Router user interface
│   ├── components/                 # React UI components (Tailwind CSS)
│   ├── lib/                        # Client-side API fetchers and localStorage helpers
│   ├── pages/                      # Next.js Pages Router views (/jobs, [id], privacy)
│   └── styles/                     # Tailwind and global stylesheet configurations
└── render.yaml                     # Render infrastructure-as-code Blueprint specification
```

</details>

---

## Quality Gates

Verify code health and test coverage using the repository quality gates:

```powershell
# 1. Type-check backend TypeScript
cd backend
pnpm typecheck

# 2. Build backend distribution bundle
pnpm build

# 3. Type-check frontend TypeScript
cd ../frontend
pnpm typecheck

# 4. Run Next.js lint suite
pnpm lint

# 5. Build frontend production bundle
pnpm build
cd ..

# 6. Execute verification suites (all 19 suites run automatically in .github/workflows/ci.yml against an ephemeral PostgreSQL instance)
cd backend
npx tsx scratch/sandboxAndCorsHardening.test.ts        # Validates code safety AST rules and UID runner sandboxing
npx tsx scratch/assertionGuard.test.ts                 # Validates assertion preservation logic
npx tsx scratch/urlNormalizationAndErrorMapping.test.ts # Validates error mapping and URL transformation safety
npx tsx scratch/containerHardening.test.ts            # Validates memory limits and HeavyOpGate concurrency
npx tsx scratch/remoteBrowserWs.test.ts                 # Validates remote Cloud Run browser integration (RB1-RB6)
npx tsx scratch/plannerGuardsAndNormalization.test.ts   # Validates planner password and locator guards
npx tsx scratch/providerFallbackChains.test.ts          # Validates LLM provider fallback routing
```

---

## Deployment

This application is designed to operate continuously across free hosting allocations: Supabase (PostgreSQL), Google Cloud Run (Remote Playwright Browser), Render (Docker Backend), and Vercel (Next.js Frontend).

### Deployment Order & Setup

1. **Supabase Database**:
   - Create a project. Obtain the pooled connection string (port 6543 with `?pgbouncer=true&connection_limit=1`) and the direct connection string (port 5432).
   - Apply Prisma migrations locally via the direct connection URL:
     ```bash
     cd backend && DATABASE_URL="postgresql://...:5432/postgres" pnpm exec prisma migrate deploy
     ```
2. **Google Cloud Run Remote Browser (`cloud-browser/`)**:
   - Create a dedicated zero-IAM service account and deploy the container to `us-west1` (Oregon Always Free):
     ```bash
     gcloud iam service-accounts create agt-browser-sa --description="AGT remote browser zero-IAM service account"
     
     gcloud run deploy agt-playwright-ws \
       --source=./cloud-browser \
       --region=us-west1 \
       --platform=managed \
       --execution-environment=gen2 \
       --cpu=2 \
       --memory=2Gi \
       --concurrency=1 \
       --min-instances=0 \
       --max-instances=1 \
       --timeout=300 \
       --cpu-throttling \
       --service-account=agt-browser-sa@<PROJECT_ID>.iam.gserviceaccount.com \
       --set-env-vars="BROWSER_WS_TOKEN=<MIN_32_CHAR_RANDOM_TOKEN>" \
       --allow-unauthenticated
     ```
   - Note the resulting Service URL (`https://<service>.a.run.app`). Keep strictly 1 active image digest in Artifact Registry to remain under the 500 MB free quota.
3. **Render Backend**:
   - In Render Dashboard, select **New +** -> **Blueprint**, link the repository (`main` branch), and let Render parse `render.yaml`.
   - In Render Dashboard -> **Environment Variables**, fill in values for all `sync: false` secrets, including `BROWSER_WS_ENDPOINT` (`wss://<service>.a.run.app/chromium/playwright`) and `BROWSER_WS_TOKEN`.
4. **Vercel Frontend**:
   - In Vercel Dashboard, import the repository with Root Directory set to `frontend`.
   - Configure environment variables: `BACKEND_URL` (`https://<service>.onrender.com`), `EDGE_SHARED_SECRET` (matching Render), and `NEXT_PUBLIC_DEPLOYMENT_MODE=production`. Deploy.

### Environment & Secrets Checklist

Secret names must match `render.yaml` exactly. Values are never committed to version control:

| Variable | Target | Purpose / Requirements |
|---|---|---|
| `DATABASE_URL` | Render | Pooled connection string (port 6543, `?pgbouncer=true&connection_limit=1`) |
| `DIRECT_URL` | Render | Direct connection string (port 5432) for migrations |
| `VISITOR_SIGNING_SECRET` | Render | HMAC key for signed visitor IDs (`openssl rand -hex 32`, min 16 chars) |
| `POW_SECRET` | Render | ALTCHA proof-of-work secret (`openssl rand -hex 32`, min 16 chars) |
| `ADMIN_SECRET` | Render | Header key for admin routes (`X-Admin-Secret`, min 24 chars) |
| `EDGE_SHARED_SECRET` | Render + Vercel | Shared token authenticating Vercel edge rewrite proxy |
| `FRONTEND_ORIGIN` | Render | Allowed CORS origin (e.g. `https://your-app.vercel.app`) |
| `GROQ_API_KEY` | Render | Primary LLM provider key (`gsk_...`) |
| `GEMINI_API_KEY` | Render | Optional fallback LLM provider key (`AIza...`) |
| `GROQ_REASONING_MODELS` | Render | Optional comma-separated model chain override for Groq reasoning tier |
| `GROQ_FAST_MODELS` | Render | Optional comma-separated model chain override for Groq fast tier |
| `GEMINI_REASONING_MODELS` | Render | Optional comma-separated model chain override for Gemini reasoning tier |
| `GEMINI_FAST_MODELS` | Render | Optional comma-separated model chain override for Gemini fast tier |
| `BROWSER_WS_ENDPOINT` | Render | Remote Playwright WebSocket endpoint (`wss://<service>.a.run.app/chromium/playwright`) |
| `BROWSER_WS_TOKEN` | Render + Cloud Run | Shared authentication token for remote Playwright WebSocket (min 32 chars recommended) |

### Free-Tier Operating Constraints & Keep-Alive

Preset via `render.yaml`: single instance, `PIPELINE_CONCURRENCY=1`, `CRAWL_CONCURRENCY=1`, and `RUNNER_TIMEOUT_SCALE=2`. To prevent cold starts and database pausing within Render's 750 free monthly hours (744 hours in a 31-day month):
- **Backend Keep-Alive**: Configure UptimeRobot to ping `GET /api/health` every 5 minutes (prevents Render container sleep).
- **Database Activity Ping**: Configure UptimeRobot to ping `GET /api/health/db` every 12 hours (issues lightweight query preventing 7-day Supabase inactivity pause).

### Post-Deploy Verification

1. Verify `/api/health` returns status `ok` and `/api/health/db` returns database `ok`.
2. Run one end-to-end generation job on `https://demo.playwright.dev/todomvc` to confirm remote crawl, plan, compile, and remote runner execution succeed.
3. Validate Playwright trace replay and download on the job page.
4. Verify edge client IP extraction via `curl -s -H "X-Admin-Secret: <SECRET>" <BACKEND>/api/admin/whoami`.
5. Test BYOK / custom-keys generation path.

### Rollback & Secrets Rotation

- **Rollback**: In Render Dashboard, navigate to **Deploys** and click **Rollback to this deploy** on the last working release. In Vercel, select the previous good deployment and click **Promote to Production**. In Cloud Run, adjust traffic revisions via `gcloud run services update-traffic`.
- **Rotation**:
  - `VISITOR_SIGNING_SECRET`: Rotate in Render (invalidates existing visitor cookies; returning users receive fresh IDs).
  - `EDGE_SHARED_SECRET`: Update simultaneously in both Render and Vercel environment variables, then redeploy both.
  - `BROWSER_WS_TOKEN`: Update simultaneously in both Cloud Run (`gcloud run services update`) and Render environment variables.
  - `ADMIN_SECRET`: Rotate anytime in Render (used only for `/api/admin/*` administrative endpoints).
  - `POW_SECRET`, `GROQ_API_KEY`, `GEMINI_API_KEY`: Rotate anytime in Render environment variables.

---

## Roadmap

- **Scenario Accuracy & Negative Template Separation:** The dual-call planner split separates core from negative planning, but the **fast/negative tier is still the driver of false findings** (5 of 10 false expectations in the latest 12-run measurement inject valid test data into a case titled "must fail"). Segregate negative cases from valid credentials in `backend/src/agent/steps/planner.ts` (`enforceTestData`) so a "must fail" case never binds the valid test-data values.
- **Navigation-Aware Correction Guidance:** Supply post-navigation page URLs and visible interactive element snapshots directly to the correction prompt, preventing locator spin on vanished selectors (measured: correction success 30.0%, all heals on strict-mode locator collisions).
- **Screenshot Artifacts:** Attach screenshot artifacts directly to test result cards for rapid debugging (owner-only Playwright trace replays already ship for every execution attempt; screenshots do not yet).
- **Production Infrastructure Rollout:** Execute production deployment to Render, Cloud Run, and Vercel following the steps outlined in the [Deployment](#deployment) section.

---

## Deliberately Not Used

| Technology / Pattern | Decision | Project-Specific Rationale |
|---|---|---|
| **LangChain / LangGraph / CrewAI** | Avoided | Direct OpenAI-compatible `fetch()` provides transparency, deterministic error mapping, zero vendor lock-in, and avoids heavy runtime dependencies. |
| **Python** | Avoided | Kept the entire system in TypeScript to share AST parsers, Playwright runner types, and Zod schemas across crawler, runner, and UI. |
| **Redux / Zustand** | Avoided | Next.js Pages Router with local React state and SWR caching satisfies all state management needs without state store boilerplate. |
| **GraphQL / tRPC** | Avoided | Standard REST endpoints with Zod request schemas cleanly support Server-Sent Events, streaming zips, and HTML file downloads. |
| **Client-Facing Live Progress WebSockets** | Avoided | Live progress is strictly unidirectional (server to browser). Server-Sent Events work seamlessly over standard HTTP proxies without WebSocket upgrade complexity. (Playwright's native WebSocket wire protocol is used strictly backend-to-Cloud-Run for remote browser orchestration). |
| **Local Chromium on 512 MB Render / Second Render Service** | Avoided | Headless Chromium rendering commercial SPAs with `--trace on` triggers cgroup `SIGKILL` (512 MB OOM). A second warm Render service would consume an additional 744 hours/mo, exhausting the account's 750 free monthly hour workspace limit mid-month. |
| **Browserless.io Free Tier** | Avoided | Live benchmarked on `flipkart.com`: 1 single job consumed 54 of 1,000 monthly units (cap of ~18 jobs/mo), took 14.25 minutes, and failed 8/10 specs (80% failure) due to Browserless Free's rigid 120s session guillotine cutting off traced test chunks. |
| **Redis** | Avoided | Single-instance deployment runs on an in-memory queue and Postgres. Redis adds unwarranted infrastructure overhead on free-tier deployments. |
| **Next.js App Router / RSC** | Avoided | Pages Router provides predictable, stable client-side lifecycle management for long-lived Server-Sent Event streams and Monaco editor instances. |
| **Vector DBs / RAG** | Avoided | The application tests live DOM structures discovered in real time. Historical embeddings are inapplicable for testing fresh DOM layouts. |
| **Paid Cloud Tiers** | Avoided | Purposefully designed to run continuously on free-tier allocations (Render, Google Cloud Run Always Free, Vercel, Supabase, Groq/Gemini free tiers) with zero hosting expenditure. |

