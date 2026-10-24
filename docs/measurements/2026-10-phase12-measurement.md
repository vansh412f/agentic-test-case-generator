# 2026-10 Live Pipeline Measurement Report — Post-Phase-12 (Commit 2563338)

> **Measurement Date**: October 21, 2026
> **Target Commit**: `256333827042d7513a3d50ffda4600e805978031` (`polishing services`, 2026-10-21)
> **Predecessor / Baseline**: [2026-10-measurement.md](./2026-10-measurement.md) (commit `c89620e`, pre-Phase-12)
> **Pipeline Configuration**: `LOCAL_AGENT_MODE=false` (Egress proxy enabled), `BASELINE_TESTS=true`, `JOB_TOKEN_BUDGET=40000` (Run 12 capped at `8000`).
> **Guard**: Run via `MEASURE=1` (`backend/scratch/measure.ts`), which self-configures the flags above plus daily limits `1000`.
> **Raw output**: `backend/scratch/measure_results.json` (untracked; **not** git-ignored — see §7).

This report measures the pipeline **after Phase 12** (new `Observe` step + dual-call two-tier planning + success-only grounding) and **Phase 12.1** (observation text normalization, cross-origin observing, planner gating), using the *same* 12-run matrix, sites, order, test data, fresh flags and budgets as the `c89620e` baseline so the two are directly comparable.

> **Note on a removed flag**: the baseline lists `A11Y_SMOKE=true`. That flag no longer exists in the product — the `smoke-3` / axe accessibility check was removed in an earlier phase, and `config.ts` has no `A11Y_SMOKE` key. The measurement therefore ran **without** any accessibility flag. This is a *truthful current-configuration* record, not a regression.

---

## 1. Environment

- **Node.js**: `v24.14.1`
- **pnpm**: `12.8.1`
- **Playwright**: `1.63.0`
- **Commit**: `256333827042d7513a3d50ffda4600e805978031`
- **Configured LLM API Keys (names only)**: `GROQ_API_KEY`, `GEMINI_API_KEY` (`NVIDIA_API_KEY` not set → `nvidia` skipped)
- **Provider order**: `groq,gemini,nvidia` (`LLM_PROVIDER_ORDER` default).
- **Providers / models that actually served calls (from step + job data)**:
  - `groq` — `openai/gpt-oss-120b` (reasoning tier): **13** planner calls, 44,848 tokens
  - `groq` — `openai/gpt-oss-20b` (fast tier): **10** planner calls, 35,079 tokens; **17** correction calls, 29,918 tokens
  - `gemini` — `gemini-2.5-flash`: **1** planner call (Run 6), 5,499 tokens
  - Total: **41** LLM calls, **115,344** tokens.
- **Fallbacks / rate limits**:
  - Provider-error fallbacks: **0**
  - Rate-limit responses: **0**
  - Proactive budget skips: **1** — Run 6 emitted `[LLM] skip groq: est 7550 tok > TPM budget` and served that reasoning call on **gemini** (`gemini-2.5-flash`, 9,624 ms). This is a Groq TPM-budget avoidance, not a provider error.
- **Pipeline flags (effective)**: `MEASURE=1`, `LOCAL_AGENT_MODE=false` (egress proxy enabled), `BASELINE_TESTS=true`, `JOB_TOKEN_BUDGET=40000` (Run 12 override `8000`), `GENERATE_DAILY_LIMIT=1000`, `FREE_VISITOR_DAILY_LIMIT=1000`, `FREE_IP_DAILY_LIMIT=1000`, 70 s cooldown between sequential runs.
- **New Phase 12 phase in the timeline**: `Observe` runs between `Crawl` and `Plan`. Median observe latency **11.2 s** per run (range 5.7 s – 22.7 s), i.e. a new cost that did not exist in the baseline.

---

## 2. 12-Run Measurement Summary Table

| site | AI | base | pass | finding | gave_up | healed | tokens | LLM calls | wall s | queued s |
|---|---|---|---|---|---|---|---|---|---|---|
| TodoMVC (todomvc-run1) | 8 | 1 | 8 | 1 | 0 | 1 | 7,688 | 3 | 66.3s | 0.75s |
| TodoMVC (cache hit) (todomvc-cache-hit) | 8 | 1 | 8 | 1 | 0 | 1 | 1,480 | 1 | 60.4s | 0.83s |
| TodoMVC (todomvc-run2) | 6 | 1 | 5 | 2 | 0 | 1 | 7,797 | 3 | 58.7s | 0.81s |
| the-internet login (the-internet-login-1) | 0 | 0 | 0 | 0 | 0 | 0 | 10,676 | 3 | 27.0s | 0.85s |
| the-internet login (the-internet-login-2) | 7 | 1 | 3 | 0 | 5 | 0 | 21,143 | 9 | 128.5s | 0.82s |
| the-internet root (the-internet-root) | 5 | 2 | 7 | 0 | 0 | 0 | 10,213 | 2 | 74.0s | 0.85s |
| saucedemo (saucedemo-1) | 3 | 1 | 4 | 0 | 0 | 0 | 9,641 | 3 | 31.7s | 0.88s |
| saucedemo (saucedemo-2) | 8 | 1 | 5 | 3 | 1 | 0 | 9,695 | 4 | 131.7s | 1.63s |
| practicetestautomation (practicetestautomation-1) | 6 | 2 | 7 | 0 | 1 | 0 | 11,275 | 4 | 105.9s | 0.94s |
| practicetestautomation (practicetestautomation-2) | 8 | 2 | 7 | 2 | 1 | 0 | 11,360 | 4 | 104.3s | 0.83s |
| practicetestautomation (no data) (practicetestautomation-no-data) | 8 | 2 | 9 | 0 | 1 | 0 | 11,542 | 4 | 93.0s | 0.82s |
| saucedemo (capped) (saucedemo-budget-cap) | 5 | 1 | 6 | 0 | 0 | 0 | 2,834 | 1 | 33.9s | 1.51s |
| **Total** | **72** | **15** | **69** | **9** | **9** | **3** | **115,344** | **41** | **915.4s** | **11.51s** |
| **Average** | **6.0** | **1.25** | **5.75** | **0.75** | **0.75** | **0.25** | **9,612** | **3.4** | **76.3s** | **0.96s** |

Column meaning is unchanged from the baseline: **AI** = planned (AI) test cases, **base** = baseline/smoke cases, **finding** = tests whose final status is a reported finding, **healed** = tests that passed after a correction attempt.

**Run 4 is a genuine measured failure, not a dropped run**: the job status is `failed` with `errorCode`/message *"Planner dual-call produced no valid test cases"*. Both dual-call sides (`reasoning` + `fast`) failed schema validation (`assert_text requires elementId or target`) and the one self-repair call also failed validation, so 0 tests were produced. It is retained in all totals. No run was retried and no run was dropped.

Overall: **69 / 87 tests passed (79.3%)**; 21 tests failed on attempt 1 (18 non-passing finals + 3 later healed).

---

## 3. Aggregates

### 3.1 Baseline-comparable metrics

- **Median tokens per run (cached vs fresh)**:
  - **Fresh runs (n=11)**: **10,213 tokens**
  - **Cached run (n=1, `todomvc-cache-hit`)**: **1,480 tokens**
  - *Observation*: the plan cache hit yields an **85.5% token reduction** (1,480 vs 10,213 median), bypassing both planner tiers entirely. Evidence: Run 2 has `phaseLatencies.planMs = 0` and `llm.callsByStep = { correct: 1 }` (no `plan` calls at all). *(Caveat: `measure.ts`'s `plan.planCacheHit` field reads `false` for every run including this one — the field is unreliable and was not used; the cache hit is established from the LLM call/latency evidence above.)*
- **Median wall time**: **70.1s** (across all 12 runs, including crawl, observe, plan, compilation, execution, correction).
- **Tokens by step type %**:
  - `plan`: **85,426 tokens** (**74.1%**)
  - `correct` (healing): **29,918 tokens** (**25.9%**)
  - `generate` (per-test LLM generation): **0 tokens** (**0.0%**)
  - `crawl`, `observe`, `validate`, `execute`: 0 LLM tokens (deterministic local code execution).
- **Plan token split across the two tiers** (derivable from `providerModels`):
  - Reasoning tier (`openai/gpt-oss-120b` + the one `gemini-2.5-flash` fallback): **14 calls, 50,347 tokens (58.9% of plan)**
  - Fast tier (`openai/gpt-oss-20b`): **10 calls, 35,079 tokens (41.1% of plan)**
- **Compiled vs LLM generate ratio**:
  - **87 / 87 tests (100.0%)** compiled straight from the test plan without invoking a `generate` LLM call (0 `generate` calls and 0 `generate` tokens across all 12 runs).
- **Correction success rate**:
  - **3 / 10 correction attempts succeeded (30.0%)**; **3 of 8 multi-attempt tests were healed (37.5%)**.
  - The 3 heals were all strict-mode locator disambiguation on TodoMVC (`tc-5`, and the corresponding cases in Runs 1–3).
  - Every healing attempt on login/role-based locators (Run 5, 8, 9, 10, 11) exhausted its attempts without success.
- **False-finding rate (headline)**:
  - **9 / 9 reported findings (100.0%) were test bugs**; **0** genuine target defects detected.
  - Counting *all* non-passing tests (findings + `gave_up`, n=18): **10 / 18 (55.6%)** are test bugs, **8 / 18 (44.4%)** are infra/locator, **0** genuine defects. See §4 for the per-test classification.

### 3.2 New Phase 12 metrics

- **Observe step latency (per run)**: median **11.2 s**, range **5.7 s – 22.7 s** (total 151.4 s across the 12 runs).
- **Observations per run by kind** (all 12 runs):

  | kind | count |
  |---|---|
  | `navigation` | 33 |
  | `popup` | 4 |
  | `form_empty_submit` | 5 |
  | `form_filled_submit` | 5 |
  | `count` | 0 |
  | **total** | **47** |

  Per-run observation counts: 3, 3, 3, 4, 4, 6, 2, 2, 6, 6, 6, 2. Notably, **TodoMVC recorded only `navigation` observations** (3) despite having a todo input — the React TodoMVC input is a bare `<input>` with a keydown handler, not a `<form>`, so no `form_*_submit` observation was possible. Similarly the `practicetestautomation` login pages (Runs 9–11) recorded only `navigation` observations. **No `count` observation was recorded in any run.**
- **Grounding-audit counts** (from §4.4): (a) success assertions with no `form_filled_submit` observation = **5**; (b) `assert_url` values absent from both observations and App Map hrefs = **0**; (c) `assert_count` without a `count` observation = **1**; (d) post-login assertions in no-test-data login runs = **0**.

### 3.3 BEFORE / AFTER delta vs `c89620e`

| Metric | Baseline `c89620e` | Now `2563338` | Delta |
|---|---|---|---|
| Tests per run | 7.0 (84 total) | 7.25 (87 total) | **+0.25/run (+3.6%)** |
| Pass rate | 66.7% (56/84) | **79.3% (69/87)** | **+12.6 pts** |
| Findings per run | 1.67 (20 total) | 0.75 (9 total) | **−0.92/run (−55.0%)** |
| **False-finding rate** | **100.0% (20/20)** | **100.0% (9/9)** | **0 pts (unchanged)** |
| True findings | 0 | 0 | 0 |
| gave_up per run | 0.67 (8) | 0.75 (9) | +0.08 |
| Healed per run | 0.08 (1) | 0.25 (3) | +0.17 |
| Correction success rate | 11.1% (1/9) | **30.0% (3/10)** | **+18.9 pts** |
| Median fresh tokens | 3,113 | 10,213 | **+228.1% (×3.28)** |
| Median wall time | 62.8s | 70.1s | **+11.6% (+7.3s)** |
| LLM calls per run | 1.8 (22) | 3.4 (41) | **+0.86× (+86.4%)** |
| Total tokens / run | 4,672 | 9,612 | **+105.7%** |

Where it got **worse**, stated plainly: dual-call planning (a reasoning call for core cases + a fast call for negative cases, plus occasional self-repair/expansion) roughly **tripled median fresh tokens** (3,113 → 10,213) and **nearly doubled LLM calls** (1.8 → 3.4/run), and added a new **~11 s observe phase** per run. The pass rate and the *number* of false findings improved; the false-finding *rate* did not.

---

## 4. Quality Audit

### 4.1 Run 1: TodoMVC (`demo.playwright.dev/todomvc`)

| testCaseId | category | assertions | strongest assertion | would it catch a real regression? | Part B class |
|---|---|---|---|---|---|
| `tc-1` | `state` | 0 | `toBeVisible` | **Weak**. Fills a todo and asserts the input is enabled/visible; does not assert the todo item itself. | — (passed) |
| `tc-2` | `negative` | 1 | `toHaveURL` | **Weak**. Empty-submit stays on app URL; app URL is not a grounded observation. | — (passed) |
| `tc-3` | `navigation` | 2 | `toHaveURL` | **Yes (grounded)**. `todomvc.com/` is an observed `navigation` fact. | — (passed) |
| `tc-4` | `navigation` | 2 | `toHaveURL` | **Yes (grounded)**. `github.com/remojansen/` is an observed `navigation` fact. | — (passed) |
| `tc-5` | `navigation` | 2 | `toHaveURL` | **Yes (grounded)**. Same target as `tc-3`; healed once from a strict-mode locator clash. | — (passed, healed) |
| `tc-6` | `state` | 0 | `toBeVisible` | **Weak**. Asserts the input clears to `""` after a real submit — correct here, but ungrounded (no `form_filled_submit` observation on TodoMVC). | — (passed) |
| `tc-7` | `negative` | 0 | `toBeVisible` | **Weak**. Empty submit + assert input value `""` (already empty). | — (passed) |
| `tc-8` | `state` | 0 | `toBeVisible` | **No**. Asserts the input clears to `""` after a **whitespace-only** submit. React TodoMVC keeps the whitespace (`Received: "   "`). | **(1) FALSE** |
| `smoke-1` | `smoke` | 2 | `toHaveTitle` | **Yes**. Baseline title assertion. | — (passed) |

### 4.2 Run 4: the-internet login (`the-internet.herokuapp.com/login`) — no tests produced

The job **failed at planning** (§2). The `observe` step *did* run and recorded 4 grounded facts, including `form_empty_submit` → "Your username is invalid!" and `form_filled_submit` → `/secure` + "You logged into a secure area!". But **both** dual-call sides and the single self-repair call failed output-schema validation (`assert_text requires elementId or target`), so 0 test cases were produced. There are no tests to classify; the run-level outcome is a **planner schema-failure** (see §5, class 5).

### 4.3 Run 7: saucedemo (`www.saucedemo.com`)

| testCaseId | category | assertions | strongest assertion | would it catch a real regression? | Part B class |
|---|---|---|---|---|---|
| `tc-1` | `validation` | 2 | `toHaveURL` | **Yes (grounded)**. Valid login → `/inventory.html`; `/inventory.html` is an observed `form_filled_submit` fact. | — (passed) |
| `tc-2` | `negative` | 1 | `toHaveURL` | **Weak**. Empty-submit stays on `/`, which is an observed `form_empty_submit` fact. | — (passed) |
| `tc-3` | `negative` | 1 | `toHaveURL` | **Weak**. Username-only submit stays on `/`. | — (passed) |
| `smoke-1` | `smoke` | 2 | `toHaveTitle` | **Yes**. Baseline title assertion. | — (passed) |

Unlike the baseline (where Run 7's negatives produced false findings via test-data injection), Run 7's negatives are **grounded on observed submit facts and passed**. The same authoring pattern *does* still break in Run 8 (see below).

### 4.4 Run 9: practicetestautomation (`/practice-test-login/`)

| testCaseId | category | assertions | strongest assertion | would it catch a real regression? | Part B class |
|---|---|---|---|---|---|
| `tc-1` | `navigation` | 1 | `toHaveURL` | **Weak**. Empty submit stays on login; the login page has no `form_*` observation, so the plan correctly produced a *negative* (no post-login claim). | — (passed) |
| `tc-2` | `navigation` | 2 | `toHaveURL` | **Yes (grounded)**. HOME → root, an observed `navigation` fact. | — (passed) |
| `tc-3` | `navigation` | 2 | `toHaveURL` | **No (locator)**. `getByRole('link', { name: 'PRACTICE', exact: true })` — the site's link text is `Practice` (observed `texts=Practice`), so the click times out. | **(3) INFRA/LOCATOR** (`gave_up`) |
| `tc-4` | `navigation` | 2 | `toHaveURL` | **Yes (grounded)**. `luma.com/6h5rs59m` is an observed `navigation` fact. | — (passed) |
| `tc-5` | `navigation` | 0 | `toBeVisible` | **Weak**. Hidden mobile nav toggle on desktop viewport. | — (passed) |
| `tc-6` | `navigation` | 2 | `toHaveURL` | **Yes (grounded)**. `/blog/` is an observed `navigation` fact. | — (passed) |
| `smoke-1` | `smoke` | 2 | `toHaveTitle` | **Yes**. Baseline title assertion. | — (passed) |
| `smoke-2` | `smoke` | 1 | `toEqual` | **Weak**. Baseline "linked pages respond" check. | — (passed) |

### 4.5 Complete list of every FALSE finding across all 12 runs

| # | Run | testCaseId | status | What the test asserted | What the site actually did (evidence) |
|---|---|---|---|---|---|
| 1 | 1 | `tc-8` | finding | After submitting `"   "`, the todo input has value `""` | Input kept the whitespace: `Expected: "" Received: "   "` (14 × resolved to `<input class="new-todo" …>`) |
| 2 | 2 | `tc-8` | finding | Same as #1 (cache-hit rerun of Run 1's plan) | Same: `Received: "   "` |
| 3 | 3 | `tc-4` | finding | After an empty submit, the todo input is **hidden** | Input is always visible; `toBeHidden()` → `Received: visible`. Also self-contradictory: asserts `toBeVisible()` then `toBeHidden()` on the same element |
| 4 | 3 | `tc-5` | finding | After a whitespace submit, the input is **hidden** | Same: input always visible (`Received: visible`); same visible→hidden contradiction |
| 5 | 8 | `tc-2` | finding | Title "Login fails when username is empty" — stay on `/` | Code fills `standard_user` + valid password and clicks Login → login **succeeds**, URL `https://www.saucedemo.com/inventory.html` (also an observed `form_filled_submit` fact) |
| 6 | 8 | `tc-3` | finding | Title "Login fails when password is empty" — stay on `/` | Same: valid credentials submitted → `/inventory.html` |
| 7 | 8 | `tc-4` | finding | Title "Login fails when both fields are empty" — stay on `/` | Same: valid credentials submitted → `/inventory.html` |
| 8 | 10 | `tc-6` | finding | "invalid credentials" → stay on `/practice-test-login/` | Code fills `student` + the real password (`__AGT_SECRET_1__`) → login succeeds, URL `https://practicetestautomation.com/logged-in-successfully/` |
| 9 | 10 | `tc-8` | finding | Same as #8 | Same: redirects to `/logged-in-successfully/` |

**Additional false expectation that ended as `gave_up` (not counted in the 9 reported findings):**

| # | Run | testCaseId | status | What the test asserted | What the site actually did |
|---|---|---|---|---|---|
| A | 8 | `tc-8` | gave_up | "Login with username only" → wait for `Epic sadface: **Username** is required` | With the username filled, saucedemo shows `Password is required`, so the wait times out (`Test timeout of 15000ms exceeded`) |

**Zero TRUE findings**: no test in any run exposed a genuine defect of a target application (e.g. no broken link returning 404, no real regression).

### 4.6 Grounding audit — counts and how they were checked

Checked by cross-referencing every planned + baseline test's steps/`assert_*` and its compiled code against that run's recorded observations (`audit.observations`).

- **(a) Tests asserting a form SUCCESS outcome where no `form_filled_submit` observation exists = 5.**
  All on TodoMVC runs (which recorded only `navigation` observations): Run 1 `tc-6`, `tc-8`; Run 2 `tc-6`, `tc-8` (assert the field resets to `""` after a submit); Run 3 `tc-1` (asserts the added todo persists after reload). Runs 4, 5, 7, 8, 12 *do* have `form_filled_submit` observations, so their success assertions are grounded. Runs 9–11 have no form observations but produced **no** positive form-success assertion at all.
- **(b) `assert_url` values present in neither observations nor App Map hrefs = 0.**
  Every `assert_url` target across all 87 tests matched either an observation `finalUrl` (navigation/popup/form_*) or the crawled page's own URL. *(Caveat: the harness captured observation `finalUrl`s, which are derived from the App Map hrefs the observer clicked; App Map hrefs were not separately serialised, so this check is "observations + app URL".)*
- **(c) `assert_count` without a `count` observation = 1.**
  Run 3 `tc-2` ("Prevent adding empty todo") uses `assert_count :: 0`. **No run recorded a single `count` observation** (`byKind.count = 0` everywhere), so every `assert_count` is by definition ungrounded — here exactly one test.
- **(d) Post-login assertions in a run WITHOUT test data for a login form = 0.**
  Runs without test data that contain a login form: Run 11 (`practicetestautomation-no-data`), and Run 6 whose root page links to `/login`. No test in Run 11 or Run 6 asserted post-login content — Run 11's login tests all assert the URL *stays* on `/practice-test-login/` and the username field stays visible, i.e. the *negative* outcome. This is consistent with the Phase 12 gating rule.

---

## 5. Residual Failure Taxonomy

Ranked by frequency across the 18 non-passing tests (+1 failed run). Class definitions: **FALSE** = the test's expectation contradicts the site's real behaviour; **INFRA/LOCATOR** = neither (strict-mode ambiguity, wrong-role locator, timing, target outage).

| Rank | Failure class | Count | Kind | Example |
|---|---|---|---|---|
| 1 | **Self-contradictory negative/validation cases** — the plan's *title* says "empty / invalid / fails", but the compiled code injects the valid test-data credentials and then asserts the login did **not** succeed | 5 | **FALSE** | Run 8 `tc-2`: title "Login fails when username is empty" but code does `fill("standard_user")` + `fill("__AGT_SECRET_1__")` then asserts URL stays on `/`; actual `https://www.saucedemo.com/inventory.html` |
| 2 | **Unobserved post-submit state assertions** — assert an element becomes hidden / a field resets, with no observation to ground it | 4 | **FALSE** | Run 1 `tc-8`: `toHaveValue("")` after a whitespace submit; actual `Received: "   "` (and Run 3 `tc-4`/`tc-5`: `toBeHidden()` on an always-visible input) |
| 3 | **Wrong-role locator on an un-roled element** — `getByRole('alert', …)` against the-internet's `div#flash` flash banner, which has no ARIA role | 4 | INFRA/LOCATOR | Run 5 `tc-1`: `getByRole('alert', { name: 'You logged into a secure area!' })` → `element(s) not found`, although the text *was* observed as a `form_filled_submit` fact |
| 4 | **Strict-mode / text-locator ambiguity** — a text/`getByText` locator matches multiple nodes, or an `exact` name does not match the site's casing | 3 | INFRA/LOCATOR | Run 10 `tc-2` / Run 11 `tc-2`: `getByText('PRACTICE')` → `strict mode violation … resolved to 4 elements`; Run 9 `tc-3`: `getByRole('link', { name: 'PRACTICE', exact: true })` vs the site's `Practice` |
| 5 | **Stale CSS-class assumption from another framework** — `div.alert-success` (Bootstrap) on the-internet's flash element | 1 | INFRA/LOCATOR | Run 5 `tc-6`: `page.waitForSelector('div.alert-success')` timed out (the real class is `flash success`) |
| 6 | **Contradictory error-message expectation** — expects the "username required" message after filling the username | 1 | **FALSE** (`gave_up`) | Run 8 `tc-8`: waits for `Epic sadface: Username is required` after filling `standard_user`; site shows `Password is required` → 15 s timeout |
| 7 | **Planner output-schema failure** — every dual-call side + the self-repair call fails validation | 1 (run) | INFRA (planner) | Run 4: *"Planner dual-call produced no valid test cases"* — all sides failed `assert_text requires elementId or target`; 0 tests, job `failed` |

Totals: **FALSE = 10** (9 reported findings + 1 `gave_up`), **INFRA/LOCATOR = 8**, **TRUE = 0**, plus **1 planner-failed run**.

---

## 6. Verdict

Observe-first grounding **did not move the headline false-finding rate**: it is still **100% (9/9)** of reported findings — every reported finding is a test bug, exactly as in the `c89620e` baseline. What it *did* move is volume and pass rate: findings dropped **20 → 9** (per run 1.67 → 0.75, −55%) and pass rate rose **66.7% → 79.3%**; correction success tripled (**11.1% → 30.0%**).

Grounding is working *where it is designed to work*: in the three `practicetestautomation` runs (9–11), whose login pages produced **no** form observation, the planner emitted **no** post-login success assertion — only "stays on login" negatives (grounding audit (a)-related = 0 for those runs). All remaining false findings come from the **fast/negative tier**, whose failure expectations are *not* covered by the success-only grounding rule: 5 of 10 false expectations are negatives that inject valid credentials and then assert failure, and 4 more assert unobserved post-submit states (hidden/reset).

The cost is real: dual-call planning **tripled median fresh tokens** (3,113 → 10,213), **+86%** LLM calls/run, and added a new **~11 s observe phase**, lifting median wall time **62.8 s → 70.1 s**. One run (Run 4) produced zero tests because both planner calls and the repair call failed schema validation. Net: **better pass rate and fewer false findings, but the same 100% false-finding rate, at roughly 3× the fresh-token cost** — the next tuning target is negating the fast/negative tier (never inject valid test data into a "must fail" case, and never assert an unobserved state change).

---

## 7. Raw Output & Harness Notes

- Raw results: `backend/scratch/measure_results.json` (284 KB, untracked). `git check-ignore` returns exit 1 for this path — the file is **NOT git-ignored** and shows as `??` in `git status`. It should not be committed (or an ignore rule should be added by the repo owner). *(Update: since added to `.gitignore` and untracked.)*
- **Harness compatibility edits** (additive only; the 12-run matrix definitions — sites, order, test data, fresh flags, budgets — are byte-identical): `measure.ts` now also captures the new `observe` phase latency, per-run observation summaries by kind, and an `audit` block (observations, plan test cases, per-test final code + attempts) so the Part B classification is reproducible from the JSON. See the accompanying change log.
- **Anomalies**: the measurement process exited with code 1 *after* all 12 runs completed and the results JSON was written — a sandbox file-write restriction on Playwright's Chromium `debug.log` / `nvAppTimestamps`, unrelated to the pipeline. No runs were retried; none dropped.
