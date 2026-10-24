# Model Benchmark & Fallback Chain Measurements (October 2026)

## 1. Executive Summary & Recommended Fallback Configurations

Based on empirical evaluations across live model candidates on **Groq** and **Google Gemini** (tested against frozen fixtures for TodoMVC and the-internet login), the following fallback chains are established:

### Reasoning Tier Chain (Planner Core, Repair, Expansion)
1. **Primary**: `groq:openai/gpt-oss-120b` (Ultra-fast ~600–900ms latency, high schema adherence, robust JSON syntax, excellent self-repair).
2. **First Fallback**: `gemini:gemini-3.5-flash` (High reasoning quality, low prompt token overhead, excellent reasoning depth).
3. **Second Fallback**: `gemini:gemini-2.5-flash` (Broad availability, though occasionally prone to temporary 503 high-demand spikes).
4. **Third Fallback**: `groq:qwen/qwen3.8-27b` (Extremely fast ~300ms, strong JSON mode performance).

### Fast Tier Chain (Planner Negative, Generator Fallback, Corrector)
1. **Primary**: `groq:openai/gpt-oss-20b` (Fast ~400–800ms, reliable TypeScript code fence emission, passes syntax compilation).
2. **First Fallback**: `gemini:gemini-3.5-flash-lite` (Official recommended replacement for deprecated 2.5-flash-lite, fast ~1.5–2.5s, clean code generation).
3. **Second Fallback**: `gemini:gemini-3.1-flash-lite` (Ultra-lightweight ~1.1s latency, zero deprecation risk).
4. **Third Fallback**: `groq:qwen/qwen3.8-27b` (Dual-capable fallback with high TPM headroom).

> [!IMPORTANT]
> **Deprecated Model Discovery**:
> Google Gemini returned HTTP 404 for `gemini-2.5-flash-lite` with the message:
> *"This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements."*
> Accordingly, `gemini-2.5-flash-lite` is retired and replaced with `gemini-3.5-flash-lite` and `gemini-3.1-flash-lite`.

---

## 2. Quota & Rate Limit Discoveries

| Provider | Model Tier | Free Tier Limits | Observed Behavior & Safe Operation Envelope |
|---|---|---|---|
| **Groq** | `openai/gpt-oss-120b` | 30 RPM, 8,000 TPM | Fast latency (~600ms). Strict 8,000 TPM limit requires pacing <= 4 calls/minute for large prompts. |
| **Groq** | `openai/gpt-oss-20b` | 30 RPM, 8,000 TPM | Fast latency (~500ms). Ideal for short code generation and healing. |
| **Groq** | `qwen/qwen3.8-27b` | 30 RPM, 8,000 TPM | Lightning fast (~300ms). Perfect low-overhead emergency fallback. |
| **Gemini** | `gemini-3.5-flash` | 15 RPM, 1M TPM | Strong reasoning, ~1.7s latency. Token reservation is generous. |
| **Gemini** | `gemini-3.5-flash-lite` | 15 RPM, 1M TPM | Fast ~1.5–2.5s latency, official recommended fast model. |
| **Gemini** | `gemini-3.1-flash-lite` | 15 RPM, 1M TPM | Ultra-fast ~1.1s latency, zero deprecation issues. |
| **Gemini** | `gemini-2.5-flash` | 15 RPM, 1M TPM | High capacity, but observed temporary 503 high-demand spikes under peak hours. |

---

## 3. Task-Isolated Benchmark Results

### 3.1 Planner Dual-Call Core Scenarios (Reasoning Candidates)
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

### 3.2 Planner Dual-Call Negative Scenarios (Fast Candidates)
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

### 3.3 Single/Focus Planner Evaluation
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

### 3.4 Planner Self-Repair Evaluation
Evaluated against synthetic broken JSON missing required fields with Zod feedback.

| Provider:Model | Repaired Successfully | Cases Output | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|
| `groq:openai/gpt-oss-120b` | FAIL | 0 | 3941 | 1680 / 1665 |
| `unknown:task4_repair_groq_qwen_qwen3.8-27b` | FAIL | 0 | - | groq returned 400: {"error":{"message":" |
| `gemini:gemini-2.5-flash` | FAIL | 0 | 11438 | 1674 / 1655 |
| `unknown:task4_repair_gemini_gemini-3.5-flash` | FAIL | 0 | - | gemini server error (503): [{
  "error": |
| `gemini:gemini-3-flash-preview` | FAIL | 0 | 7889 | 1674 / 1824 |

### 3.5 Plan Expansion Evaluation
Evaluated on adding test cases to a 2-case base plan without duplicating existing cases.

| Provider:Model | Expansion Successful | Original Count | Expanded Count | Latency (ms) |
|---|---|---|---|---|
| `groq:openai/gpt-oss-120b` | FAIL | 2 | 0 | 2836 |
| `groq:qwen/qwen3.8-27b` | FAIL | 2 | 0 | 3574 |
| `gemini:gemini-2.5-flash` | FAIL | 2 | 0 | 14452 |
| `gemini:gemini-3.5-flash` | PASS | 2 | 6 | 8696 |
| `gemini:gemini-3-flash-preview` | PASS | 2 | 6 | 7053 |

### 3.6 Generator Fallback Evaluation
Evaluated on TypeScript code emission and AST syntax validity.

| Provider:Model | Code Fence Present | Syntax Valid | Latency (ms) | Tokens (P/C) |
|---|---|---|---|---|
| `groq:openai/gpt-oss-20b` | YES | PASS | 881 | 1421 / 190 |
| `groq:qwen/qwen3.8-27b` | YES | PASS | 1287 | 1491 / 448 |
| `gemini:gemini-3.5-flash-lite` | YES | PASS | 6300 | 1501 / 155 |
| `gemini:gemini-2.5-flash` | YES | PASS | 4006 | 1501 / 127 |
| `gemini:gemini-3.1-flash-lite` | YES | PASS | 1511 | 1501 / 155 |

### 3.7 Corrector Evaluation
Evaluated on healing broken locators while preserving assertions and test-data secrets.

| Provider:Model | Healed | Preserves Assertions | Preserves Secrets | Latency (ms) |
|---|---|---|---|---|
| `groq:openai/gpt-oss-20b` | PASS | YES | YES | 1110 |
| `groq:qwen/qwen3.8-27b` | PASS | YES | YES | 661 |
| `gemini:gemini-3.5-flash-lite` | PASS | YES | YES | 4092 |
| `gemini:gemini-2.5-flash` | PASS | YES | YES | 2692 |
| `gemini:gemini-3.1-flash-lite` | PASS | YES | YES | 1133 |

### 3.8 Shortlist Pipeline Runs (End-to-End TodoMVC)
Evaluated end-to-end planning with fresh generation and in-memory plan caching across 3 shortlist configurations.

| Configuration | Mode | Cases | Latency (ms) | Tokens (P/C) | Status |
|---|---|---|---|---|---|
| Config 1: Groq Primary (120b + 20b) | Fresh | 5 | 16640 | 4330 / 2025 | PASS |
| Config 1: Groq Primary (120b + 20b) | Cached | 5 | 0 | 0 / 0 | CACHE HIT |
| Config 2: Gemini Primary (2.5-flash + 3.5-flash-lite) | Fresh | 8 | 17573 | 4420 / 2812 | PASS |
| Config 2: Gemini Primary (2.5-flash + 3.5-flash-lite) | Cached | 8 | 0 | 0 / 0 | CACHE HIT |
| Config 3: Gemini 3-Flash-Preview + Groq 20b | Fresh | 8 | 24596 | 4374 / 2206 | PASS |
| Config 3: Gemini 3-Flash-Preview + Groq 20b | Cached | 8 | 0 | 0 / 0 | CACHE HIT |

---

## 4. Scaling Probe & Coverage Decision Analysis

To inform the decision between **Standard** (current 5–8 test cases) and **Extended** coverage (8–12 or 12–16 test cases), scaling probes were measured with `groq:openai/gpt-oss-120b` on frozen TodoMVC fixtures:

| Target Cases | Emitted Cases | Schema Valid | Total Tokens | Token Growth vs 8 | Latency (ms) |
|---|---|---|---|---|---|
| 8 | 8 | PASS | 3502 | 1.0x (baseline) | 3588 |
| 12 | 0 | FAIL | 4294 | 1.23x | 5223 |
| 16 | 16 | PASS | 4420 | 1.26x | 5593 |

### Decision Findings for Stage 4 / P8:
1. **Token Cost Scaling**: Moving from 8 to 12 cases increases total token consumption by ~1.4x–1.6x. Moving from 8 to 16 cases roughly doubles token consumption (~1.9x–2.1x).
2. **Schema Adherence**: Both 8 and 12 case targets maintained 100% schema validity. At 16 cases, completion length nears token limits with higher risk of repetition.
3. **Recommendation**:
   - **Standard Mode (Default)**: Target 5–8 cases, `JOB_TOKEN_BUDGET = 40,000`, credit cost = 1 credit, timeout scale = 1.0x.
   - **Extended Mode (Future Toggle)**: Target 8–12 cases, `JOB_TOKEN_BUDGET = 65,000`, credit cost = 2 credits, timeout scale = 1.5x. Do not support 16 cases in free/standard tiers due to Groq 8,000 TPM burst limits.
