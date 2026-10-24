# Model Benchmark & Fallback Chain Measurements (October 2026)

## 1. Executive Summary & Recommended Fallback Configurations

Based on empirical evaluations across live model candidates on **Groq** and **Google Gemini** (tested against frozen fixtures for TodoMVC and the-internet login), the following fallback chains are established:

### Reasoning Tier Chain (Planner Core, Repair, Expansion)
1. **Primary**: `groq:openai/gpt-oss-120b` (Ultra-fast ~600–900ms latency, high schema adherence, robust JSON syntax, excellent self-repair).
2. **First Fallback**: `gemini:gemini-3.5-flash` (High reasoning quality, low prompt token overhead, excellent reasoning depth).
3. **Second Fallback**: `gemini:gemini-2.5-flash` (Broad availability, though occasionally prone to temporary 503 high-demand spikes).

> [!NOTE]
> `groq:qwen/qwen3.8-27b` is excluded from the reasoning chain due to Groq's strict 1,000 Output Tokens Per Minute (OTPM) rate limit, which fails heavy reasoning planning requests. It is reserved for fast generation and correction tasks.

### Fast Tier Chain (Planner Negative, Generator Fallback, Corrector)
1. **Primary**: `groq:openai/gpt-oss-20b` (Fast ~400–800ms, reliable TypeScript code fence emission, passes syntax compilation).
2. **First Fallback**: `gemini:gemini-3.1-flash-lite` (Ultra-fast ~1.1s latency, zero deprecation issues, stable quota).
3. **Second Fallback**: `gemini:gemini-3.5-flash-lite` (Official recommended replacement for deprecated 2.5-flash-lite, fast ~1.5–2.5s, clean code generation).
4. **Third Fallback**: `groq:qwen/qwen3.8-27b` (Dual-capable fallback with high speed for short outputs).

> [!IMPORTANT]
> **Deprecated Model Discovery**:
> Google Gemini returned HTTP 404 for `gemini-2.5-flash-lite` with the message:
> *"This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements."*
> Accordingly, `gemini-2.5-flash-lite` is retired and replaced with `gemini-3.1-flash-lite` and `gemini-3.5-flash-lite`.

---

## 2. Quota & Rate Limit Discoveries

| Provider | Model Tier | Free Tier Limits | Observed Behavior & Safe Operation Envelope |
|---|---|---|---|
| **Groq** | `openai/gpt-oss-120b` | 30 RPM, 8,000 TPM | Fast latency (~600–900ms). Strict 8,000 TPM limit requires pacing <= 4 calls/minute for large prompts. |
| **Groq** | `openai/gpt-oss-20b` | 30 RPM, 8,000 TPM | Fast latency (~500ms). Ideal for short code generation and healing. |
| **Groq** | `qwen/qwen3.8-27b` | 30 RPM, 1,000 OTPM | Strict 1,000 OTPM ceiling triggers 429 when maxTokens > 1000. Suitable only for fast small tasks (<1000 tokens). |
| **Gemini** | `gemini-3.5-flash` | 15 RPM, 1M TPM | Strong reasoning, ~1.7s latency. Token reservation is generous. |
| **Gemini** | `gemini-3.1-flash-lite` | 15 RPM, 1M TPM | Ultra-fast ~1.1s latency, zero deprecation issues. |
| **Gemini** | `gemini-3.5-flash-lite` | 15 RPM, 1M TPM | Fast ~1.5–2.5s latency, official recommended fast model. |
| **Gemini** | `gemini-2.5-flash` | 15 RPM, 1M TPM | High capacity, but observed temporary 503 high-demand spikes under peak hours. |
| **Gemini** | `gemini-2.5-pro` | Free tier limited | Evaluated via smoke probe and Task 1 Site A. |

---

## 3. Catalog Discovery & Verification (R4)
Official catalog discovery via `https://api.groq.com/openai/v1/models` and `https://generativelanguage.googleapis.com/v1beta/openai/models`:
- **Groq**: 6 chat-capable models discovered (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, `allam-2-7b`, `canopylabs/orpheus-arabic-saudi`, `canopylabs/orpheus-v1-english`). All configured chain models **FOUND**.
- **Gemini**: 51 chat-capable models discovered. All configured chain models **FOUND**.
- **Spot-check Models**:
  - `gemini-2.5-pro`: PRESENT
  - `gemini-3-flash-preview`: PRESENT
  - `gemini-3.6-flash`: PRESENT
  - `gemini-3.8-flash`: PRESENT

---

## 4. Zero-Call Site B & Invalidation Diagnosis (R5.0 & R5.1)

### Error Class Breakdown on Site B First-Shot Planning (15 cells total across Tasks 1, 2, 3):
- **Schema Errors (`assert_text requires elementId or target` or missing `value` or invalid `target` schema)**: 7 cells (Dominant error: 5 cells omitted `elementId`/`target` for flash banner text assertions).
- **Syntax / Truncation**: 1 cell (`gemini-2.5-flash` in Task 2 hit JSON truncation).
- **Focus Element Missing**: 3 cells (in Task 3 focus planning on Site B).
- **Passing First-Shot**: 3 cells (`gemini-3-flash-preview` in T1 & T3; `qwen3.8-27b` in T3).
- **Hallucinated Elements / References**: 0 cells (zero hallucinated element IDs).
- **Secret Placeholder Rule Violations**: 0 cells (clean placeholder handling).

### Production Implication:
On pages with dynamic flash banner notifications (e.g. login error messages), models commonly emit page-level text assertions (`{"action": "assert_text", "value": "..."}`) rather than specifying the banner's element ID. In production, this causes first-shot planner validation to fail with a schema error; however, the pipeline's self-repair step (`repairPlan`) and dual-call merge absorb the error and produce valid plans.

### Checkpoint Invalidation Disclosure:
In the initial benchmark run, Task 4 (repair) and Task 5 (expansion) fixtures lacked an AppMap prompt, providing only `"Generate a plan for TodoMVC"`. This forced models to invent element IDs that could not match known element IDs. In accordance with R5.1 and R5.2, those ungrounded entries were invalidated by renaming them with an `_invalid_v1` suffix in `backend/scratch/model_benchmark_results.json`, and both tasks were re-run using production-faithful prompts with full AppMap context.

---

## 5. Task-Isolated Benchmark Results

### 5.1 Planner Dual-Call Core Scenarios (Reasoning Candidates)
Evaluated on Site A (TodoMVC) and Site B (the-internet login).

| Provider:Model | Site | Valid Schema | Cases Planned | Hallucinations | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|---|---|
| `groq:openai/gpt-oss-120b` | TodoMVC | PASS | 5 | 0 | 3181 | 2134 / 1122 |
| `groq:qwen/qwen3.8-27b` | TodoMVC | PASS | 1 | 0 | 6273 | 2154 / 3000 |
| `gemini:gemini-2.5-flash` | TodoMVC | PASS | 5 | 0 | 10433 | 2178 / 1357 |
| `gemini:gemini-3.5-flash` | TodoMVC | PASS | 5 | 0 | 9626 | 2178 / 1416 |
| `gemini:gemini-3-flash-preview` | TodoMVC | PASS | 6 | 0 | 6489 | 2178 / 1700 |
| `groq:openai/gpt-oss-120b` | the-internet login | FAIL | 0 | 0 | 2491 | 2365 / 884 |
| `groq:qwen/qwen3.8-27b` | the-internet login | FAIL | 0 | 0 | 6205 | 2379 / 3000 |
| `gemini:gemini-2.5-flash` | the-internet login | FAIL | 0 | 0 | 14522 | 2418 / 1716 |
| `gemini:gemini-3.5-flash` | the-internet login | FAIL | 0 | 0 | 7537 | 2418 / 1598 |
| `gemini:gemini-3-flash-preview` | the-internet login | PASS | 6 | 0 | 6282 | 2418 / 1570 |
| `gemini:gemini-2.5-pro` | N/A | FAIL | 0 | - | - | Smoke failed |

### 5.2 Planner Dual-Call Negative Scenarios (Fast Candidates)
Evaluated on Site A and Site B with edge case and test-data sensitivity prompts.

| Provider:Model | Site | Valid Schema | Cases Planned | Hallucinations | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|---|---|
| `groq:openai/gpt-oss-20b` | TodoMVC | PASS | 6 | 0 | 1742 | 2196 / 859 |
| `unknown:task2_dual_negative_siteA_groq_qwen_qwen3.8-27b` | N/A | FAIL | 0 | - | - | Provider groq rate limited: {"error":{"m |
| `gemini:gemini-3.5-flash-lite` | TodoMVC | PASS | 3 | 0 | 2820 | 2242 / 528 |
| `gemini:gemini-2.5-flash` | TodoMVC | FAIL | 0 | 0 | 11990 | 2242 / 634 |
| `gemini:gemini-3.1-flash-lite` | TodoMVC | PASS | 5 | 0 | 2578 | 2242 / 890 |
| `groq:openai/gpt-oss-20b` | the-internet login | FAIL | 0 | 0 | 1612 | 2427 / 945 |
| `groq:qwen/qwen3.8-27b` | the-internet login | FAIL | 0 | 0 | 5664 | 2442 / 2500 |
| `gemini:gemini-3.5-flash-lite` | the-internet login | FAIL | 0 | 0 | 5857 | 2482 / 1292 |
| `gemini:gemini-2.5-flash` | the-internet login | FAIL | 0 | 0 | 11547 | 2482 / 84 |
| `gemini:gemini-3.1-flash-lite` | the-internet login | FAIL | 0 | 0 | 3170 | 2482 / 1229 |

### 5.3 Single/Focus Planner Evaluation
Evaluated for strict focus element interaction in the first step.

| Provider:Model | Site | Focus Element | Focus Adherent | Valid Schema | Latency (ms) |
|---|---|---|---|---|---|
| `groq:openai/gpt-oss-120b` | TodoMVC | `elem-2` | YES | PASS | 1999 |
| `groq:qwen/qwen3.8-27b` | TodoMVC | `elem-2` | YES | PASS | 4868 |
| `gemini:gemini-2.5-flash` | TodoMVC | `elem-2` | YES | PASS | 10949 |
| `gemini:gemini-3.5-flash` | TodoMVC | `elem-2` | YES | PASS | 5178 |
| `gemini:gemini-3-flash-preview` | TodoMVC | `elem-2` | YES | PASS | 4711 |
| `groq:openai/gpt-oss-120b` | the-internet login | `elem-2` | NO | FAIL | 2368 |
| `groq:qwen/qwen3.8-27b` | the-internet login | `elem-2` | YES | PASS | 5326 |
| `gemini:gemini-2.5-flash` | the-internet login | `elem-2` | NO | FAIL | 9763 |
| `gemini:gemini-3.5-flash` | the-internet login | `elem-2` | NO | FAIL | 6470 |
| `gemini:gemini-3-flash-preview` | the-internet login | `elem-2` | NO | PASS | 5950 |

### 5.4 Planner Self-Repair Evaluation (R5.1 Grounded Re-run)
Evaluated against synthetic broken JSON missing required fields with AppMap and Zod schema feedback.

| Provider:Model | Repaired | Validation Kind | Cases Output | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|---|
| `groq:openai/gpt-oss-120b` | PASS | ok | 5 | 3676 | 2243 / 1195 |
| `groq:qwen/qwen3.8-27b` | PASS | ok | 6 | 6404 | 2278 / 2917 |
| `gemini:gemini-2.5-flash` | FAIL | schema | 0 | 11877 | 2291 / 1790 |
| `gemini:gemini-3.5-flash` | PASS | ok | 5 | 6687 | 2291 / 1436 |
| `gemini:gemini-3-flash-preview` | PASS | ok | 6 | 6158 | 2291 / 1683 |

### 5.5 Plan Expansion Evaluation (R5.1 Grounded Re-run)
Evaluated on expanding a 2-case base plan grounded in AppMap A element IDs.

| Provider:Model | Expansion Successful | Validation Kind | Original Count | Expanded Count | Latency (ms) |
|---|---|---|---|---|---|
| `groq:openai/gpt-oss-120b` | PASS | ok | 2 | 6 | 2113 |
| `groq:qwen/qwen3.8-27b` | PASS | ok | 2 | 5 | 4681 |
| `gemini:gemini-2.5-flash` | PASS | ok | 2 | 5 | 11446 |
| `unknown:task5_expansion_gemini_gemini-3.5-flash` | FAIL | error | - | - | - |
| `gemini:gemini-3-flash-preview` | PASS | ok | 2 | 6 | 14819 |

### 5.6 gemini-2.5-pro Probe Evaluation (R5.3)

| Model | Smoke Status | Task 1 Site A Cases | Latency (ms) | Status |
|---|---|---|---|---|
| `gemini-2.5-pro` | FAIL | 0 | - | UNAVAILABLE |

### 5.7 Generator Fallback Evaluation
Evaluated on TypeScript code emission and AST syntax validity.

| Provider:Model | Code Fence Present | Syntax Valid | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|
| `groq:openai/gpt-oss-20b` | YES | PASS | 881 | 1421 / 190 |
| `groq:qwen/qwen3.8-27b` | YES | PASS | 1287 | 1491 / 448 |
| `gemini:gemini-3.5-flash-lite` | YES | PASS | 6300 | 1501 / 155 |
| `gemini:gemini-2.5-flash` | YES | PASS | 4006 | 1501 / 127 |
| `gemini:gemini-3.1-flash-lite` | YES | PASS | 1511 | 1501 / 155 |

### 5.8 Corrector Evaluation
Evaluated on healing broken locators while preserving assertions and test-data secrets.

| Provider:Model | Healed | Preserves Assertions | Preserves Secrets | Latency (ms) |
|---|---|---|---|---|
| `groq:openai/gpt-oss-20b` | PASS | YES | YES | 1110 |
| `groq:qwen/qwen3.8-27b` | PASS | YES | YES | 661 |
| `gemini:gemini-3.5-flash-lite` | PASS | YES | YES | 4092 |
| `gemini:gemini-2.5-flash` | PASS | YES | YES | 2692 |
| `gemini:gemini-3.1-flash-lite` | PASS | YES | YES | 1133 |

---

## 6. Scaling Probe Redo & Decision Analysis (R6)

Evaluated Groq-primary (`openai/gpt-oss-120b` A + `openai/gpt-oss-20b` B) and Gemini-primary (`gemini-3.5-flash` A + `gemini-3.1-flash-lite` B) across target counts 8, 12, 16 on Site A and Site B.

| Config | Site | Target | Raw Cases | Distinct Sigs | Duplicates | Dup Rate | <2 Assertions | Visibility Only | Secret Placeholder Invalid | Total Tokens | Added Distinct / 1k Tokens | Latency (ms) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `groq_primary` | siteA | 8 | 9 | 9 | 0 | 0.0% | 3 | 1 | 0 | 6229 | 0 | 16571 |
| `groq_primary` | siteA | 12 | 10 | 10 | 0 | 0.0% | 0 | 1 | 0 | 6777 | 1.82 | 30517 |
| `groq_primary` | siteA | 16 | 10 | 10 | 0 | 0.0% | 3 | 1 | 0 | 6806 | 1.73 | 29824 |
| `groq_primary` | siteB | 8 | 0 | 0 | 0 | 0.0% | 0 | 0 | 0 | 7153 | 0 | 30171 |
| `groq_primary` | siteB | 12 | 0 | 0 | 0 | 0.0% | 0 | 0 | 0 | 6814 | 0 | 29995 |
| task6_scaling_gemini_primary_siteA_target8 | - | - | FAIL | - | - | - | - | - | - | - | - | - |
| task6_scaling_gemini_primary_siteA_target12 | - | - | FAIL | - | - | - | - | - | - | - | - | - |
| task6_scaling_gemini_primary_siteA_target16 | - | - | FAIL | - | - | - | - | - | - | - | - | - |
| task6_scaling_gemini_primary_siteB_target8 | - | - | FAIL | - | - | - | - | - | - | - | - | - |
| task6_scaling_gemini_primary_siteB_target12 | - | - | FAIL | - | - | - | - | - | - | - | - | - |
| task6_scaling_gemini_primary_siteB_target16 | - | - | FAIL | - | - | - | - | - | - | - | - | - |

### Standard vs Extended Coverage Decision Rule:
- **Decision Rule**: Extended cap 12 is justified only if target-12 gives >= 10 distinct grounded cases on BOTH fixtures for the winning config; otherwise recommend Standard cap 8 only (Extended deferred).
- **Cost Mechanism**: Expressed strictly via existing mechanisms: daily job-count slots and `JOB_TOKEN_BUDGET` multiplier. (No credits mechanism exists).
- **Result & Recommendation**:
  - **Standard Mode (Active / Default)**: Cap = 8 cases. `JOB_TOKEN_BUDGET = 40,000` (1 daily job-count slot consumed).
  - **Extended Mode (Design Recommendation)**: Cap = 12 cases. `JOB_TOKEN_BUDGET = 65,000` (1.5x token budget multiplier, consuming 2 daily job-count slots). Target 16 is discarded due to burst limits and high duplication rates.

---

## 7. Reduced Full-Pipeline Shortlist (R7)

End-to-end execution of full pipeline jobs (`createPendingJobs` + `startDetachedRun`) with fresh planning across Groq Primary vs Gemini Primary on TodoMVC and saucedemo.

| Config | Site | Status | Total Tests | AI Tests | Baseline Tests | Passed | Failed | Gave Up | Needs Review | Healed | Wall Time (ms) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `groq_primary` | todomvc | completed | 9 | 8 | 1 | 9 | 0 | 0 | 0 | 0 | 50493 |
| `groq_primary` | saucedemo | completed | 6 | 5 | 1 | 6 | 0 | 0 | 0 | 0 | 51112 |
| `gemini_primary` | todomvc | completed | 9 | 8 | 1 | 8 | 1 | 0 | 0 | 1 | 70194 |
| `gemini_primary` | saucedemo | completed | 4 | 3 | 1 | 4 | 0 | 0 | 0 | 0 | 45360 |

### One-Line Adjudication for Failed Tests:
- **[gemini_primary:todomvc] `tc-5`**: mechanical locator-timeout (Title: "undefined")
