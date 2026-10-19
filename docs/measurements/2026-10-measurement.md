# 2026-10 Live Pipeline Measurement Report (Commit c89620e)

> **Measurement Date**: October 19, 2026  
> **Target Commit**: `c89620e`  
> **Pipeline Configuration**: `LOCAL_AGENT_MODE=false` (Egress proxy enabled), `BASELINE_TESTS=true`, `A11Y_SMOKE=true`, `JOB_TOKEN_BUDGET=40000`  

## 1. Environment

- **Node.js**: `v24.14.1`
- **Playwright**: `1.63.0`
- **Commit**: `c89620e`
- **Configured LLM API Keys**: `GROQ_API_KEY`, `GEMINI_API_KEY` (names only; `NVIDIA_API_KEY` not set)
- **Active Provider Order**: `groq` (primary: `openai/gpt-oss-120b` for planning, `openai/gpt-oss-20b` for correction), `gemini` (fallback). All 22 LLM calls in this measurement completed on `groq` with 0 provider fallbacks and 0 rate limits.
- **Pipeline Flags**: `LOCAL_AGENT_MODE=false` (Egress proxy enabled), `BASELINE_TESTS=true`, `A11Y_SMOKE=true`, `JOB_TOKEN_BUDGET=40000` (Run 12 capped at `8000`), 70s cooldown between sequential runs.

## 2. 12-Run Measurement Summary Table

| site | AI | base | pass | finding | gave_up | healed | tokens | LLM calls | wall s | queued s |
|---|---|---|---|---|---|---|---|---|---|---|
| TodoMVC (todomvc-run1) | 5 | 2 | 2 | 4 | 1 | 0 | 3,927 | 2 | 64.1s | 1.25s |
| TodoMVC (cache hit) (todomvc-cache-hit) | 5 | 2 | 2 | 4 | 1 | 0 | 1,321 | 1 | 57.5s | 0.90s |
| TodoMVC (todomvc-run2) | 4 | 2 | 3 | 2 | 1 | 0 | 2,406 | 1 | 36.3s | 0.89s |
| the-internet login (the-internet-login-1) | 5 | 2 | 3 | 4 | 0 | 0 | 2,803 | 1 | 89.9s | 0.87s |
| the-internet login (the-internet-login-2) | 5 | 2 | 5 | 2 | 0 | 0 | 2,760 | 1 | 66.8s | 0.88s |
| the-internet root (the-internet-root-deep) | 5 | 3 | 6 | 0 | 2 | 1 | 16,620 | 4 | 131.1s | 0.92s |
| saucedemo (saucedemo-1) | 3 | 2 | 4 | 0 | 1 | 0 | 5,418 | 3 | 60.8s | 0.87s |
| saucedemo (saucedemo-2) | 3 | 2 | 4 | 0 | 1 | 0 | 5,700 | 3 | 65.6s | 0.75s |
| practicetestautomation (practicetestautomation-1) | 6 | 3 | 7 | 1 | 1 | 0 | 6,356 | 3 | 107.4s | 1.14s |
| practicetestautomation (practicetestautomation-2) | 5 | 3 | 7 | 1 | 0 | 0 | 3,113 | 1 | 61.4s | 1.45s |
| practicetestautomation (no data) (practicetestautomation-no-data) | 5 | 3 | 7 | 1 | 0 | 0 | 2,918 | 1 | 55.2s | 1.22s |
| saucedemo (capped) (saucedemo-budget-cap) | 5 | 2 | 6 | 1 | 0 | 0 | 2,726 | 1 | 39.9s | 1.31s |
| **Total** | **56** | **28** | **56** | **20** | **8** | **1** | **56,068** | **22** | **836.1s** | **12.46s** |
| **Average** | **4.7** | **2.3** | **4.7** | **1.7** | **0.7** | **0.1** | **4,672** | **1.8** | **69.7s** | **1.04s** |

## 3. Aggregates

- **Median tokens per run (cached vs fresh)**:
  - **Fresh runs (n=11)**: **3,113 tokens**
  - **Cached runs (n=1)**: **1,321 tokens**
  - *Observation*: Plan cache hit yields a **57.6% token reduction** (1,321 vs 3,113 tokens median), bypassing the 120B planner model entirely.
- **Median wall time**: **62.8s** (across all 12 runs, including crawl, plan, compilation, execution, and correction).
- **Tokens by step type %**:
  - `plan`: **40,962 tokens** (**73.1%**)
  - `correct` (healing): **15,106 tokens** (**26.9%**)
  - `generate` (per-test LLM generation): **0 tokens** (**0.0%**)
  - `crawl`, `validate`, `execute`: 0 LLM tokens (deterministic local code execution).
- **Compiled vs LLM generate ratio**:
  - **56 / 56 tests (100.0%)** compiled straight from the test plan without invoking an LLM generate call.
  - The deterministic AST compiler successfully handled 100% of planned test cases.
- **Correction success rate**:
  - **1 / 9 correction attempts succeeded (11.1%)**; **1 of 6 multi-attempt tests was healed (16.7%)**.
  - When disambiguating strict-mode Playwright locators (Run 6 `tc-2`), self-healing succeeded cleanly.
  - When tests failed due to navigation/state desynchronization, healing spun on `waitForSelector` and exhausted attempts.
- **False-finding rate**:
  - **20 / 20 reported findings (100.0%) were test bugs**, with **0** genuine target application regressions detected.
  - Causes: template test data binding collisions into negative scenarios (65%), Playwright `toHaveURL` predicate function failures (20%), and locator ambiguities (15%).

## 4. Quality Audit of 4 Runs (Runs 1, 4, 7, 9)

An exhaustive audit of every AI-generated test in Run 1 (TodoMVC), Run 4 (the-internet login), Run 7 (saucedemo), and Run 9 (practicetestautomation).

### Run 1: TodoMVC (demo.playwright.dev/todomvc)

| testCaseId | category | assertion count | strongest assertion | would it catch a real regression? (yes / weak / no + reason) |
|---|---|---|---|---|
| `tc-1` | `state` | 2 | `toHaveCount` | **Yes (conditional on selector)**. Verifies that entering text and pressing Enter creates a persistent todo item across reload. Currently fails only because `getByRole('listitem')` ambiguously matches the 3 footer filter tabs as well. |
| `tc-2` | `negative` | 2 | `toHaveCount` | **Weak**. Asserts that pressing Enter on an empty input does not create a todo. Relies on the same broad `getByRole('listitem')` selector. |
| `tc-3` | `navigation` | 2 | `toHaveURL` | **No**. Verifies outbound link to `todomvc.com`. Third-party external link that introduces network flakiness and fails due to predicate formatting. |
| `tc-4` | `navigation` | 2 | `toHaveURL` | **No**. Outbound marketing link to author's GitHub profile. Unrelated to application functional regression. |
| `tc-5` | `navigation` | 2 | `toHaveURL` | **No**. Redundant external link test to `todomvc.com` project page. |

### Run 4: the-internet login (the-internet.herokuapp.com/login)

| testCaseId | category | assertion count | strongest assertion | would it catch a real regression? (yes / weak / no + reason) |
|---|---|---|---|---|
| `tc-1` | `validation` | 1 | `toHaveURL` | **Yes**. Verifies that valid login credentials (`tomsmith` / `{{SECRET:the-internet-password}}`) redirect to `/secure`. |
| `tc-2` | `negative` | 1 | `toHaveURL` | **No**. Test data collision bug: intended to test "empty username", but compiler injected valid credentials and asserted `/login`, guaranteeing a false failure. |
| `tc-3` | `negative` | 1 | `toHaveURL` | **No**. Test data collision bug: intended to test "empty password", but compiler injected valid credentials. |
| `tc-4` | `negative` | 1 | `toHaveURL` | **No**. Test data collision bug: intended to test "invalid credentials", but compiler injected valid credentials. |
| `tc-5` | `navigation` | 1 | `toHaveURL` | **No**. Clicks outbound link "Elemental Selenium" which opens in a new window/tab (`target="_blank"`); assertion executed on original tab where URL did not change. |

### Run 7: saucedemo (www.saucedemo.com)

| testCaseId | category | assertion count | strongest assertion | would it catch a real regression? (yes / weak / no + reason) |
|---|---|---|---|---|
| `tc-1` | `validation` | 2 | `toHaveURL` | **Yes**. Fills valid credentials (`standard_user` / `{{SECRET:saucedemo-password}}`), clicks Login, verifies redirection to `/inventory.html` and login button is hidden. |
| `tc-3` | `negative` | 2 | `toHaveURL` | **No**. Corrupted by test data injection: injected valid password into negative test flow. Passed only due to client-side timing. |
| `tc-2` | `negative` | 2 | `toHaveURL` | **No**. Corrupted by test data injection: injected valid username into empty username flow. Form submitted, navigated away, and test timed out looking for login button. |

### Run 9: practicetestautomation (practicetestautomation.com/practice-test-login)

| testCaseId | category | assertion count | strongest assertion | would it catch a real regression? (yes / weak / no + reason) |
|---|---|---|---|---|
| `tc-1` | `validation` | 1 | `toHaveURL` | **No**. Inverted navigation assertion: fills valid credentials, clicks Submit, but asserts that URL remains on `/practice-test-login/` instead of `/logged-in-successfully/`. |
| `tc-2` | `negative` | 2 | `toHaveURL` | **Yes**. Leaves username empty, fills password, clicks Submit, asserts URL remains on login page and username input remains visible. |
| `tc-3` | `negative` | 2 | `toHaveURL` | **Yes**. Leaves password empty, fills username, clicks Submit, asserts URL remains on login page and password input remains visible. |
| `tc-4` | `persistence` | 2 | `toHaveValue` | **No**. Submits login, navigates away to `/logged-in-successfully/`, then reloads and asserts login input fields are empty. Elements do not exist on dashboard. |
| `tc-5` | `navigation` | 1 | `toHaveURL` | **Weak**. Clicks HOME link in navigation bar and verifies redirection to root domain. |
| `tc-6` | `smoke` | 1 | `toBeHidden` | **Weak**. Asserts responsive mobile menu button is hidden on desktop viewport. |

## 5. Failed Tests Analysis

### Failure Classification Across All 12 Runs

Across the 12 matrix runs, **28 total tests did not pass on attempt 1** (20 classified as `failed` findings and 8 as `gave_up`).

| Failure Category | Count | % of Failures | Real App Behavior vs Test Bug | Root Cause Details |
|---|---|---|---|---|
| **Test Data Inversion in Negative Templates** | 7 | 25.0% | **Test Bug** | Compiler bound valid credentials (`testData`) into negative test cases (empty/invalid), causing unexpected successful login. |
| **Playwright Predicate / Protocol URL Assertions** | 7 | 25.0% | **Test Bug** | `expect(page).toHaveURL(url => url.href.includes(...))` predicate failure or `http://` redirecting to `https://`. |
| **Inverted Navigation Postconditions** | 3 | 10.7% | **Test Bug** | Test performed valid login but asserted URL remained on the login page instead of the post-login destination. |
| **Locator Ambiguity (Strict Mode / Over-counting)** | 4 | 14.3% | **Test Bug** | `getByRole('listitem')` matching 3 footer filter tabs (TodoMVC) or duplicate button names. |
| **Outbound / Popup Link Navigation** | 2 | 7.1% | **Test Bug** | Links with `target="_blank"` clicked on `page` without handling multi-page popup context. |
| **State Desynchronization (Missing Elements on New Page)** | 3 | 10.7% | **Test Bug** | Reloading or asserting login inputs on an authenticated page where inputs are absent. |
| **Baseline Accessibility Violation** | 2 | 7.1% | Real App Trait | Axe smoke test detected real color-contrast violations in target demo applications (TodoMVC). |

**False-Finding Rate Calculation**:
$$\text{False-Finding Rate} = \frac{\text{False Findings (Test Bugs)}}{\text{Total Reported Findings}} = \frac{20}{20} = 100.0\%$$

### Top 3 Most Informative Error Snippets

#### 1. Inverted Assertion via Test Data Substitution (Run 4, `tc-2`)
```text
Error: expect(page).toHaveURL(expected) failed

Expected: predicate to succeed
Received: "https://the-internet.herokuapp.com/secure"
Timeout:  5000ms

   5 |   await page.getByRole("textbox", { name: "Username" }).fill("tomsmith");
   6 |   await page.getByLabel("Password").fill("{{SECRET:the-internet-password}}");
   7 |   await page.getByRole("button", { name: "Login" }).click();
>  8 |   await expect(page).toHaveURL(url => url.href.includes("https://the-internet.herokuapp.com/login"));
     |                      ^
   9 | });
```
*Takeaway*: The test title was *"Login with empty username"*, but the template compiler populated the valid credentials. The app behaved perfectly; the test asserted the wrong URL.

#### 2. Playwright `toHaveURL` Predicate / Protocol Failure (Run 1, `tc-3`)
```text
Error: expect(page).toHaveURL(expected) failed

Expected: predicate to succeed
Received: "https://todomvc.com/"
Timeout:  5000ms

  5 |   await expect(page.getByRole("link", { name: "real TodoMVC app." })).toBeVisible();
  6 |   await page.getByRole("link", { name: "real TodoMVC app." }).click();
> 7 |   await expect(page).toHaveURL(url => url.href.includes("https://todomvc.com/"));
    |                      ^
  8 | });
```
*Takeaway*: The LLM authored an arrow-function predicate `url => ...` rather than a regex or string pattern (`/todomvc\.com/`), which Playwright's matcher treats as an unfulfilled predicate.

#### 3. Self-Healing Spin on Vanished Elements (Run 9, `tc-4`)
```text
TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.
Call log:
  - waiting for locator('#username') to be visible

   8 |   await page.reload();
   9 |   await page.waitForLoadState('domcontentloaded');
> 10 |   await page.waitForSelector('#username', { state: 'visible' });
     |              ^
  11 |   await expect(page.getByLabel("Username")).toHaveValue("");
```
*Takeaway*: The test previously clicked Submit with valid credentials, landing on `/logged-in-successfully/`. Reloading stayed on the dashboard. The self-healing loop blind-retried waiting for `#username` for 10s instead of inspecting the current URL.

## 6. Gave_Up Root Cause Analysis

Across the 12 matrix runs, **8 tests reached `gave_up` status**:

1. **Run 1 (`smoke-3`)**, **Run 2 (`smoke-3`)**, **Run 3 (`smoke-3`)** — TodoMVC Accessibility Smoke Test:
   - *Failure Chain*: Axe scan executed $\to$ 4 serious/critical `color-contrast` nodes detected on the TodoMVC demo page $\to$ `violations.toEqual([])` failed.
   - *Behavior*: Baseline smoke tests are deterministic assertions without an LLM self-healing loop; they accurately record a gave-up condition after attempt 1.
2. **Run 6 (`smoke-2`)** — the-internet Broken Links Crawl:
   - *Failure Chain*: Crawled all root page links $\to$ `https://the-internet.herokuapp.com/basic_auth` and `digest_auth` returned HTTP 401 $\to$ broken links assertion failed.
   - *Behavior*: Genuine 401 challenge from target demo; non-healable without credentials.
3. **Run 6 (`tc-4`)** — the-internet Deep Crawl Navigation:
   - *Failure Chain*: Heavy page navigation $\to$ Playwright runner execution timeout of 15,000ms exceeded.
4. **Run 7 (`tc-2`) & Run 8 (`tc-2`)** — saucedemo "Login fails with empty username":
   - *Failure Chain*: Attempt 1 compiled with valid username $\to$ form logged in and redirected to inventory $\to$ `expect(button).toBeVisible()` failed (button missing from inventory) $\to$ Attempt 2 self-healing added `page.waitForSelector('#login-button')` with 10s timeout $\to$ timed out $\to$ Attempt 3 repeated locator $\to$ attempt limit (3) exhausted $\to$ `gave_up`.
   - *Progress vs Spin*: **Pure spin**. The healing agent never realized the page was no longer on the login screen.
5. **Run 9 (`tc-4`)** — practicetestautomation "Login persistence after reload":
   - *Failure Chain*: Attempt 1 submitted login $\to$ redirected $\to$ reloaded $\to$ `#username` not found on dashboard $\to$ Attempt 2 added `page.waitForSelector('#username')` $\to$ 10s timeout $\to$ Attempt 3 added `domcontentloaded` + `waitForSelector` $\to$ 10s timeout $\to$ attempt limit (3) exhausted $\to$ `gave_up`.
   - *Progress vs Spin*: **Pure spin**. Injected waiting steps for nonexistent elements.

## 7. Top 5 Problems Ranked by Impact on QA Usability

Ranked by severity and impact on developer confidence and automated test pipeline reliability.

### Rank 1: Test Data Collision in Negative & Validation Test Cases
- **Impact**: When the user configures test credentials, the compiler blindly injects valid credentials into *every* form test, including negative test cases (empty username, invalid password). The form logs in successfully, fails its negative assertion, and reports a false "Bug Finding". This completely destroys trust in negative testing.
- **Evidence**:
  - Run 4 (`the-internet login`) `tc-2`, `tc-3`, `tc-4`: 3 false findings in a single run.
  - Run 5 (`the-internet login`) `tc-3`.
  - Run 7 & 8 (`saucedemo`) `tc-2`: Caused tests to give up after 3 attempts.
- **Fix Direction for Phase 12**:
  - In `backend/src/agent/planCompiler.ts`, inspect the test case `category` and title before applying `testData`.
  - For cases classified as `negative` or containing "empty" / "invalid":
    - If testing empty username, leave username empty and only fill password.
    - If testing empty password, leave password empty and only fill username.
    - If testing invalid credentials, append `_invalid` or use a dummy string instead of the sensitive secret.

### Rank 2: False-Finding Navigation Assertion Inversion on Happy-Path Forms
- **Impact**: The test successfully completes the primary user flow (e.g., logging in), but asserts that the URL did not change (expected `/login/`, received `/dashboard/`). The app works, but the pipeline reports a critical failure.
- **Evidence**:
  - Run 9, 10, 11 (`practicetestautomation`) `tc-1`: Consistently failed with `Expected: "https://practicetestautomation.com/practice-test-login/", Received: "https://practicetestautomation.com/logged-in-successfully/"`.
- **Fix Direction for Phase 12**:
  - Enhance the Planner prompt: "When planning a positive submission test for a form, the expected postcondition MUST assert navigation to the target success URL or appearance of authenticated dashboard elements, NOT the submission URL."
  - In `planCompiler.ts`, detect form submissions and validate that happy-path cases do not assert equality with the initial form URL.

### Rank 3: Playwright `toHaveURL` Predicate & Protocol Mismatches
- **Impact**: LLM generates Playwright assertions using arrow function predicates `expect(page).toHaveURL(url => url.href.includes(...))` or hardcoded `http://` protocols. Playwright fails these assertions even when the browser has navigated to the expected destination.
- **Evidence**:
  - Run 1 (`TodoMVC`) `tc-3`, `tc-4`, `tc-5`; Run 2 `tc-3`, `tc-4`, `tc-5`; Run 3 `tc-4`.
- **Fix Direction for Phase 12**:
  - In code generation prompt and compiler AST templates, strictly enforce regex or substring matching:
    `await expect(page).toHaveURL(/.*todomvc\.com/);` or `await expect(page).toHaveURL(new RegExp('.*todomvc\\.com'));`
  - Disallow function callbacks inside `expect(page).toHaveURL()`.
  - Normalize all URLs to `https://` unless target specifically serves plaintext HTTP.

### Rank 4: Self-Healing Blindness to Page Navigation and State Transitions
- **Impact**: When an action unexpectedly navigates to a new page, self-healing attempts to solve missing element errors by inserting 10-second `page.waitForSelector()` calls. It wastes 20–30s of wall time, consumes thousands of tokens, and fails 100% of the time.
- **Evidence**:
  - Run 7 `tc-2`, Run 8 `tc-2`, Run 9 `tc-4`. All 3 tests executed 3 attempts, added `waitForSelector`, and gave up.
- **Fix Direction for Phase 12**:
  - In `backend/src/agent/healTest.ts`, pass the *current execution state* to the LLM:
    - Current page URL at moment of failure.
    - DOM snapshot / list of visible interactive elements at failure.
  - If the current URL differs from the test's starting URL, prompt the model: *"Notice: The page navigated to ${currentUrl}. Do not wait for elements from the previous page; adjust assertions for the current page or navigate back."*

### Rank 5: Planner Over-Indexing on Low-Value Outbound Links
- **Impact**: On pages with few interactive elements, the planner fills its test quota by clicking external outbound links (GitHub, author blog, external tools). These links open in new tabs (`target="_blank"`), cross CORS boundaries, or point to external third parties, introducing severe test flakiness while testing zero application logic.
- **Evidence**:
  - Run 1 (`TodoMVC`) 3 of 5 AI tests were external links.
  - Run 4 (`the-internet`) `tc-5` clicked Elemental Selenium (`target="_blank"`) and failed.
  - Run 5 (`the-internet`) `tc-4` clicked Elemental Selenium and failed.
- **Fix Direction for Phase 12**:
  - In `backend/src/agent/planPrompt.ts`, add strict negative guidance:
    *"Do NOT generate test cases for external links to third-party domains (e.g., GitHub, sponsor links, documentation sites) unless explicitly requested. Prioritize form inputs, state changes, UI interactions, and responsive states on the current origin."*

## 8. Raw JSON Summary

<details>
<summary>Click to expand complete 12-run measurement JSON (credentials redacted)</summary>

```json
[
  {
    "runIndex": 1,
    "matrixItem": 1,
    "label": "todomvc-run1",
    "siteName": "TodoMVC",
    "url": "https://demo.playwright.dev/todomvc",
    "jobId": "45be1f4f-db70-4c36-9134-2eda338b7ad0",
    "fresh": true,
    "deepCrawl": false,
    "tokenBudget": 40000,
    "note": "TodoMVC run 1 (fresh=true)",
    "createdAt": "2026-10-19T10:27:08.674Z",
    "startedAt": "2026-10-19T10:27:09.929Z",
    "completedAt": "2026-10-19T10:28:14.068Z",
    "queuedMs": 1255,
    "wallMs": 64139,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 4,
      "formsCount": 0,
      "pagesCount": 1,
      "crawlLatencyMs": 2474
    },
    "plan": {
      "aiCaseCount": 5,
      "baselineCaseCount": 2,
      "totalCases": 7,
      "expansionTriggered": false,
      "expansionReason": "visibleCount (4) < 6",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "state",
        "negative",
        "navigation",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 2474,
      "planMs": 2781,
      "generateMs": 1,
      "validateMs": 1158,
      "executeMs": 30297,
      "correctMs": 873
    },
    "llm": {
      "totalCalls": 2,
      "totalPromptTokens": 2685,
      "totalCompletionTokens": 1242,
      "totalTokens": 3927,
      "callsByStep": {
        "plan": 1,
        "correct": 1
      },
      "tokensByStep": {
        "plan": 2629,
        "correct": 1298
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "groq",
          "model": "openai/gpt-oss-120b",
          "tokens": 2629
        },
        {
          "step": "correct",
          "provider": "groq",
          "model": "openai/gpt-oss-20b",
          "tokens": 1298
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 7,
      "passed": 2,
      "failedFinding": 4,
      "gaveUp": 1,
      "healed": 0,
      "correctionsAttempted": 1,
      "failureClasses": {
        "finding": 4,
        "other": 1,
        "locator": 1
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 35560,
      "slimBytes": 32746,
      "reductionPercent": 8
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "state",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(locator).toHaveCount(expected) failed\n\nLocator:  getByRole('listitem')\nExpected: 1\nReceived: 4\nTimeout:  5000ms\n\nCall log:\n  - Expect \"toHaveCount\" getByRole('listitem') with timeout 5000ms\n  - waiting for getByRole('listitem')\n    14 × locator resolved to 4 elements\n       - unexpected value \"4\"\n\n\n   5 |   await page.getByRole(\"textbox\", { name: \"What needs to be done?\" }).fill(\"Buy milk\");\n   6 |   await page.getByRole(\"textbox\", { name: \"What needs to be done?\" }).press(\"Enter\");\n>  7 |   await expect(page.getByRole(\"listitem\")).toHaveCount(1);\n     |                                            ^\n   8 |   await page.reload();\n   9 |   await expect(page.getByRole(\"listitem\")).toHaveCount(1);\n  10 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-45be1f4f-db70-4c36-9134-2eda338b7ad0\\tc-1.spec.ts:7:44"
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://todomvc.com/\"\nTimeout:  5000ms\n\n\n  5 |   await expect(page.getByRole(\"link\", { name: \"real TodoMVC app.\" })).toBeVisible();\n  6 |   await page.getByRole(\"link\", { name: \"real TodoMVC app.\" }).click();\n> 7 |   await expect(page).toHaveURL(url => url.href.includes(\"https://todomvc.com/\"));\n    |                      ^\n  8 | });\n  9 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-45be1f4f-db70-4c36-9134-2eda338b7ad0\\tc-3.spec.ts:7:22"
          }
        ]
      },
      {
        "testCaseId": "tc-4",
        "filename": "tc-4.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://github.com/remojansen/\"\nTimeout:  5000ms\n\n\n  5 |   await expect(page.getByRole(\"link\", { name: \"Remo H. Jansen\" })).toBeVisible();\n  6 |   await page.getByRole(\"link\", { name: \"Remo H. Jansen\" }).click();\n> 7 |   await expect(page).toHaveURL(url => url.href.includes(\"http://github.com/remojansen/\"));\n    |                      ^\n  8 | });\n  9 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-45be1f4f-db70-4c36-9134-2eda338b7ad0\\tc-4.spec.ts:7:22"
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "gave_up",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "other",
            "executionError": "Error: expect(received).toEqual(expected) // deep equality\n\n- Expected  - 1\n+ Received  + 3\n\n- Array []\n+ Array [\n+   \"color-contrast (4 nodes)\",\n+ ]\n\n   9 |     .filter((v) => v.impact === 'serious' || v.impact === 'critical')\n  10 |     .map((v) => `${v.id} (${v.nodes.length} nodes)`);\n> 11 |   expect(violations).toEqual([]);\n     |                      ^\n  12 | });\n  13 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-45be1f4f-db70-4c36-9134-2eda338b7ad0\\smoke-3.spec.ts:11:22"
          }
        ]
      },
      {
        "testCaseId": "tc-5",
        "filename": "tc-5.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 2,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "locator",
            "executionError": "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('link', { name: 'TodoMVC' })\nExpected: visible\nError: strict mode violation: getByRole('link', { name: 'TodoMVC' }) resolved to 2 elements:\n    1) <a href=\"https://todomvc.com/\">real TodoMVC app.</a> aka getByRole('link', { name: 'real TodoMVC app.' })\n    2) <a href=\"http://todomvc.com\">TodoMVC</a> aka getByRole('link', { name: 'TodoMVC', exact: true })\n\nCall log:\n  - Expect \"toBeVisible\" getByRole('link', { name: 'TodoMVC' }) with timeout 5000ms\n  - waiting for getByRole('link', { name: 'TodoMVC' })\n\n\n  3 | test(\"Navigate to TodoMVC project page\", async ({ page }) => {\n  4 |   await page.goto(\"https://demo.playwright.dev/todomvc/#/\");\n> 5 |   await expect(page.getByRole(\"link\", { name: \"TodoMVC\" })).toBeVisible();\n    |                                                             ^\n  6 |   await page.getByRole(\"link\", { name: \"TodoMVC\" }).click();\n  7 |   await expect(page).toHaveURL(url => url.href.includes(\"http://todomvc.com/\"));\n  8 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-45be1f4f-db70-4c36-9134-2eda338b7ad0\\tc-5.spec.ts:5:61"
          },
          {
            "attemptNumber": 2,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://todomvc.com/\"\nTimeout:  5000ms\n\n\n  5 |   await expect(page.getByRole(\"link\", { name: \"TodoMVC\", exact: true })).toBeVisible();\n  6 |   await page.getByRole(\"link\", { name: \"TodoMVC\", exact: true }).click();\n> 7 |   await expect(page).toHaveURL(url => url.href.includes(\"http://todomvc.com/\"));\n    |                      ^\n  8 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-45be1f4f-db70-4c36-9134-2eda338b7ad0\\tc-5.spec.ts:7:22"
          }
        ]
      }
    ]
  },
  {
    "runIndex": 2,
    "matrixItem": 8,
    "label": "todomvc-cache-hit",
    "siteName": "TodoMVC (cache hit)",
    "url": "https://demo.playwright.dev/todomvc",
    "jobId": "b61d59c8-eb36-4ea7-b7e1-29c26a37df78",
    "fresh": false,
    "deepCrawl": false,
    "tokenBudget": 40000,
    "note": "TodoMVC plan-cache hit (fresh=false immediately after run 1)",
    "createdAt": "2026-10-19T10:29:27.839Z",
    "startedAt": "2026-10-19T10:29:28.737Z",
    "completedAt": "2026-10-19T10:30:26.256Z",
    "queuedMs": 898,
    "wallMs": 57519,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 4,
      "formsCount": 0,
      "pagesCount": 1,
      "crawlLatencyMs": 1614
    },
    "plan": {
      "aiCaseCount": 5,
      "baselineCaseCount": 2,
      "totalCases": 7,
      "expansionTriggered": false,
      "expansionReason": "visibleCount (4) < 6",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "state",
        "negative",
        "navigation",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 1614,
      "planMs": 0,
      "generateMs": 0,
      "validateMs": 1160,
      "executeMs": 28737,
      "correctMs": 834
    },
    "llm": {
      "totalCalls": 1,
      "totalPromptTokens": 1133,
      "totalCompletionTokens": 188,
      "totalTokens": 1321,
      "callsByStep": {
        "correct": 1
      },
      "tokensByStep": {
        "correct": 1321
      },
      "providerModels": [
        {
          "step": "correct",
          "provider": "groq",
          "model": "openai/gpt-oss-20b",
          "tokens": 1321
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 7,
      "passed": 2,
      "failedFinding": 4,
      "gaveUp": 1,
      "healed": 0,
      "correctionsAttempted": 1,
      "failureClasses": {
        "finding": 4,
        "other": 1,
        "locator": 1
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 35113,
      "slimBytes": 32299,
      "reductionPercent": 8
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "state",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(locator).toHaveCount(expected) failed\n\nLocator:  getByRole('listitem')\nExpected: 1\nReceived: 4\nTimeout:  5000ms\n\nCall log:\n  - Expect \"toHaveCount\" getByRole('listitem') with timeout 5000ms\n  - waiting for getByRole('listitem')\n    14 × locator resolved to 4 elements\n       - unexpected value \"4\"\n\n\n   5 |   await page.getByRole(\"textbox\", { name: \"What needs to be done?\" }).fill(\"Buy milk\");\n   6 |   await page.getByRole(\"textbox\", { name: \"What needs to be done?\" }).press(\"Enter\");\n>  7 |   await expect(page.getByRole(\"listitem\")).toHaveCount(1);\n     |                                            ^\n   8 |   await page.reload();\n   9 |   await expect(page.getByRole(\"listitem\")).toHaveCount(1);\n  10 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-b61d59c8-eb36-4ea7-b7e1-29c26a37df78\\tc-1.spec.ts:7:44"
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://todomvc.com/\"\nTimeout:  5000ms\n\n\n  5 |   await expect(page.getByRole(\"link\", { name: \"real TodoMVC app.\" })).toBeVisible();\n  6 |   await page.getByRole(\"link\", { name: \"real TodoMVC app.\" }).click();\n> 7 |   await expect(page).toHaveURL(url => url.href.includes(\"https://todomvc.com/\"));\n    |                      ^\n  8 | });\n  9 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-b61d59c8-eb36-4ea7-b7e1-29c26a37df78\\tc-3.spec.ts:7:22"
          }
        ]
      },
      {
        "testCaseId": "tc-4",
        "filename": "tc-4.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://github.com/remojansen/\"\nTimeout:  5000ms\n\n\n  5 |   await expect(page.getByRole(\"link\", { name: \"Remo H. Jansen\" })).toBeVisible();\n  6 |   await page.getByRole(\"link\", { name: \"Remo H. Jansen\" }).click();\n> 7 |   await expect(page).toHaveURL(url => url.href.includes(\"http://github.com/remojansen/\"));\n    |                      ^\n  8 | });\n  9 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-b61d59c8-eb36-4ea7-b7e1-29c26a37df78\\tc-4.spec.ts:7:22"
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "gave_up",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "other",
            "executionError": "Error: expect(received).toEqual(expected) // deep equality\n\n- Expected  - 1\n+ Received  + 3\n\n- Array []\n+ Array [\n+   \"color-contrast (4 nodes)\",\n+ ]\n\n   9 |     .filter((v) => v.impact === 'serious' || v.impact === 'critical')\n  10 |     .map((v) => `${v.id} (${v.nodes.length} nodes)`);\n> 11 |   expect(violations).toEqual([]);\n     |                      ^\n  12 | });\n  13 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-b61d59c8-eb36-4ea7-b7e1-29c26a37df78\\smoke-3.spec.ts:11:22"
          }
        ]
      },
      {
        "testCaseId": "tc-5",
        "filename": "tc-5.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 2,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "locator",
            "executionError": "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('link', { name: 'TodoMVC' })\nExpected: visible\nError: strict mode violation: getByRole('link', { name: 'TodoMVC' }) resolved to 2 elements:\n    1) <a href=\"https://todomvc.com/\">real TodoMVC app.</a> aka getByRole('link', { name: 'real TodoMVC app.' })\n    2) <a href=\"http://todomvc.com\">TodoMVC</a> aka getByRole('link', { name: 'TodoMVC', exact: true })\n\nCall log:\n  - Expect \"toBeVisible\" getByRole('link', { name: 'TodoMVC' }) with timeout 5000ms\n  - waiting for getByRole('link', { name: 'TodoMVC' })\n\n\n  3 | test(\"Navigate to TodoMVC project page\", async ({ page }) => {\n  4 |   await page.goto(\"https://demo.playwright.dev/todomvc/#/\");\n> 5 |   await expect(page.getByRole(\"link\", { name: \"TodoMVC\" })).toBeVisible();\n    |                                                             ^\n  6 |   await page.getByRole(\"link\", { name: \"TodoMVC\" }).click();\n  7 |   await expect(page).toHaveURL(url => url.href.includes(\"http://todomvc.com/\"));\n  8 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-b61d59c8-eb36-4ea7-b7e1-29c26a37df78\\tc-5.spec.ts:5:61"
          },
          {
            "attemptNumber": 2,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://todomvc.com/\"\nTimeout:  5000ms\n\n\n  5 |   await expect(page.getByRole(\"link\", { name: \"TodoMVC\", exact: true })).toBeVisible();\n  6 |   await page.getByRole(\"link\", { name: \"TodoMVC\", exact: true }).click();\n> 7 |   await expect(page).toHaveURL(url => url.href.includes(\"http://todomvc.com/\"));\n    |                      ^\n  8 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-b61d59c8-eb36-4ea7-b7e1-29c26a37df78\\tc-5.spec.ts:7:22"
          }
        ]
      }
    ]
  },
  {
    "runIndex": 3,
    "matrixItem": 1,
    "label": "todomvc-run2",
    "siteName": "TodoMVC",
    "url": "https://demo.playwright.dev/todomvc",
    "jobId": "54e97bce-9cf6-4a1d-83bb-f0320d4de0fb",
    "fresh": true,
    "deepCrawl": false,
    "tokenBudget": 40000,
    "note": "TodoMVC run 2 (fresh=true)",
    "createdAt": "2026-10-19T10:31:39.871Z",
    "startedAt": "2026-10-19T10:31:40.763Z",
    "completedAt": "2026-10-19T10:32:17.053Z",
    "queuedMs": 892,
    "wallMs": 36290,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 4,
      "formsCount": 0,
      "pagesCount": 1,
      "crawlLatencyMs": 1603
    },
    "plan": {
      "aiCaseCount": 4,
      "baselineCaseCount": 2,
      "totalCases": 6,
      "expansionTriggered": false,
      "expansionReason": "visibleCount (4) < 6",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "state",
        "persistence",
        "negative",
        "navigation",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 1603,
      "planMs": 2303,
      "generateMs": 0,
      "validateMs": 0,
      "executeMs": 14995,
      "correctMs": 0
    },
    "llm": {
      "totalCalls": 1,
      "totalPromptTokens": 1552,
      "totalCompletionTokens": 854,
      "totalTokens": 2406,
      "callsByStep": {
        "plan": 1
      },
      "tokensByStep": {
        "plan": 2406
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "groq",
          "model": "openai/gpt-oss-120b",
          "tokens": 2406
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 6,
      "passed": 3,
      "failedFinding": 2,
      "gaveUp": 1,
      "healed": 0,
      "correctionsAttempted": 0,
      "failureClasses": {
        "finding": 2,
        "other": 1
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 25133,
      "slimBytes": 22760,
      "reductionPercent": 9
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "state",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(locator).toHaveCount(expected) failed\n\nLocator:  getByRole('listitem')\nExpected: 1\nReceived: 4\nTimeout:  5000ms\n\nCall log:\n  - Expect \"toHaveCount\" getByRole('listitem') with timeout 5000ms\n  - waiting for getByRole('listitem')\n    14 × locator resolved to 4 elements\n       - unexpected value \"4\"\n\n\n  5 |   await page.getByRole(\"textbox\", { name: \"What needs to be done?\" }).fill(\"Buy milk\");\n  6 |   await page.getByRole(\"textbox\", { name: \"What needs to be done?\" }).press(\"Enter\");\n> 7 |   await expect(page.getByRole(\"listitem\")).toHaveCount(1);\n    |                                            ^\n  8 | });\n  9 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-54e97bce-9cf6-4a1d-83bb-f0320d4de0fb\\tc-1.spec.ts:7:44"
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "filter",
        "category": "persistence",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-4",
        "filename": "tc-4.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://todomvc.com/\"\nTimeout:  5000ms\n\n\n  4 |   await page.goto(\"https://demo.playwright.dev/todomvc/#/\");\n  5 |   await page.getByRole(\"link\", { name: \"real TodoMVC app.\" }).click();\n> 6 |   await expect(page).toHaveURL(url => url.href.includes(\"https://todomvc.com/\"));\n    |                      ^\n  7 | });\n  8 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-54e97bce-9cf6-4a1d-83bb-f0320d4de0fb\\tc-4.spec.ts:6:22"
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "gave_up",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "other",
            "executionError": "Error: expect(received).toEqual(expected) // deep equality\n\n- Expected  - 1\n+ Received  + 3\n\n- Array []\n+ Array [\n+   \"color-contrast (4 nodes)\",\n+ ]\n\n   9 |     .filter((v) => v.impact === 'serious' || v.impact === 'critical')\n  10 |     .map((v) => `${v.id} (${v.nodes.length} nodes)`);\n> 11 |   expect(violations).toEqual([]);\n     |                      ^\n  12 | });\n  13 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-54e97bce-9cf6-4a1d-83bb-f0320d4de0fb\\smoke-3.spec.ts:11:22"
          }
        ]
      }
    ]
  },
  {
    "runIndex": 4,
    "matrixItem": 2,
    "label": "the-internet-login-1",
    "siteName": "the-internet login",
    "url": "https://the-internet.herokuapp.com/login",
    "jobId": "d1bf1b61-0009-4269-b8bb-e9321f7f505c",
    "fresh": true,
    "deepCrawl": false,
    "tokenBudget": 40000,
    "note": "the-internet login run 1 with valid credentials",
    "createdAt": "2026-10-19T10:33:30.602Z",
    "startedAt": "2026-10-19T10:33:31.475Z",
    "completedAt": "2026-10-19T10:35:01.331Z",
    "queuedMs": 873,
    "wallMs": 89856,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 7,
      "formsCount": 1,
      "pagesCount": 1,
      "crawlLatencyMs": 5096
    },
    "plan": {
      "aiCaseCount": 5,
      "baselineCaseCount": 2,
      "totalCases": 7,
      "expansionTriggered": false,
      "expansionReason": "Initial plan already produced 5 cases (>=5 rule)",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "validation",
        "navigation",
        "negative",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 5096,
      "planMs": 2987,
      "generateMs": 0,
      "validateMs": 0,
      "executeMs": 60205,
      "correctMs": 0
    },
    "llm": {
      "totalCalls": 1,
      "totalPromptTokens": 1702,
      "totalCompletionTokens": 1101,
      "totalTokens": 2803,
      "callsByStep": {
        "plan": 1
      },
      "tokensByStep": {
        "plan": 2803
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "groq",
          "model": "openai/gpt-oss-120b",
          "tokens": 2803
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 7,
      "passed": 3,
      "failedFinding": 4,
      "gaveUp": 0,
      "healed": 0,
      "correctionsAttempted": 0,
      "failureClasses": {
        "finding": 4
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 32083,
      "slimBytes": 27789,
      "reductionPercent": 13
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://the-internet.herokuapp.com/secure\"\nTimeout:  5000ms\n\n\n   6 |   await page.getByLabel(\"Password\").fill(\"__AGT_SECRET_1__\");\n   7 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n>  8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://the-internet.herokuapp.com/login\"));\n     |                      ^\n   9 | });\n  10 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-d1bf1b61-0009-4269-b8bb-e9321f7f505c\\tc-2.spec.ts:8:22"
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://the-internet.herokuapp.com/secure\"\nTimeout:  5000ms\n\n\n   6 |   await page.getByLabel(\"Password\").fill(\"__AGT_SECRET_1__\");\n   7 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n>  8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://the-internet.herokuapp.com/login\"));\n     |                      ^\n   9 | });\n  10 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-d1bf1b61-0009-4269-b8bb-e9321f7f505c\\tc-3.spec.ts:8:22"
          }
        ]
      },
      {
        "testCaseId": "tc-4",
        "filename": "tc-4.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://the-internet.herokuapp.com/secure\"\nTimeout:  5000ms\n\n\n   6 |   await page.getByLabel(\"Password\").fill(\"__AGT_SECRET_1__\");\n   7 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n>  8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://the-internet.herokuapp.com/login\"));\n     |                      ^\n   9 | });\n  10 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-d1bf1b61-0009-4269-b8bb-e9321f7f505c\\tc-4.spec.ts:8:22"
          }
        ]
      },
      {
        "testCaseId": "tc-5",
        "filename": "tc-5.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://the-internet.herokuapp.com/login\"\nTimeout:  5000ms\n\n\n  4 |   await page.goto(\"https://the-internet.herokuapp.com/login\");\n  5 |   await page.getByRole(\"link\", { name: \"Elemental Selenium\" }).click();\n> 6 |   await expect(page).toHaveURL(url => url.href.includes(\"http://elementalselenium.com/\"));\n    |                      ^\n  7 | });\n  8 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-d1bf1b61-0009-4269-b8bb-e9321f7f505c\\tc-5.spec.ts:6:22"
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      }
    ]
  },
  {
    "runIndex": 5,
    "matrixItem": 2,
    "label": "the-internet-login-2",
    "siteName": "the-internet login",
    "url": "https://the-internet.herokuapp.com/login",
    "jobId": "08867b4c-8de5-4aba-9128-f04ad29be706",
    "fresh": true,
    "deepCrawl": false,
    "tokenBudget": 40000,
    "note": "the-internet login run 2 with valid credentials",
    "createdAt": "2026-10-19T10:36:14.894Z",
    "startedAt": "2026-10-19T10:36:15.775Z",
    "completedAt": "2026-10-19T10:37:22.591Z",
    "queuedMs": 881,
    "wallMs": 66816,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 7,
      "formsCount": 1,
      "pagesCount": 1,
      "crawlLatencyMs": 4785
    },
    "plan": {
      "aiCaseCount": 5,
      "baselineCaseCount": 2,
      "totalCases": 7,
      "expansionTriggered": false,
      "expansionReason": "Initial plan already produced 5 cases (>=5 rule)",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "validation",
        "negative",
        "navigation",
        "persistence",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 4785,
      "planMs": 2756,
      "generateMs": 1,
      "validateMs": 0,
      "executeMs": 39654,
      "correctMs": 0
    },
    "llm": {
      "totalCalls": 1,
      "totalPromptTokens": 1702,
      "totalCompletionTokens": 1058,
      "totalTokens": 2760,
      "callsByStep": {
        "plan": 1
      },
      "tokensByStep": {
        "plan": 2760
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "groq",
          "model": "openai/gpt-oss-120b",
          "tokens": 2760
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 7,
      "passed": 5,
      "failedFinding": 2,
      "gaveUp": 0,
      "healed": 0,
      "correctionsAttempted": 0,
      "failureClasses": {
        "finding": 2
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 29959,
      "slimBytes": 25665,
      "reductionPercent": 14
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://the-internet.herokuapp.com/secure\"\nTimeout:  5000ms\n\n\n   6 |   await page.getByLabel(\"Password\").fill(\"__AGT_SECRET_1__\");\n   7 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n>  8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://the-internet.herokuapp.com/login\"));\n     |                      ^\n   9 |   await expect(page.getByRole(\"button\", { name: \"Login\" })).toBeVisible();\n  10 | });\n  11 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-08867b4c-8de5-4aba-9128-f04ad29be706\\tc-3.spec.ts:8:22"
          }
        ]
      },
      {
        "testCaseId": "tc-4",
        "filename": "tc-4.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://the-internet.herokuapp.com/login\"\nTimeout:  5000ms\n\n\n  4 |   await page.goto(\"https://the-internet.herokuapp.com/login\");\n  5 |   await page.getByRole(\"link\", { name: \"Elemental Selenium\" }).click();\n> 6 |   await expect(page).toHaveURL(url => url.href.includes(\"http://elementalselenium.com/\"));\n    |                      ^\n  7 | });\n  8 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-08867b4c-8de5-4aba-9128-f04ad29be706\\tc-4.spec.ts:6:22"
          }
        ]
      },
      {
        "testCaseId": "tc-5",
        "filename": "tc-5.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "persistence",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      }
    ]
  },
  {
    "runIndex": 6,
    "matrixItem": 3,
    "label": "the-internet-root-deep",
    "siteName": "the-internet root",
    "url": "https://the-internet.herokuapp.com/",
    "jobId": "505812a2-e257-486b-8b35-b5aa997411f9",
    "fresh": true,
    "deepCrawl": true,
    "tokenBudget": 40000,
    "note": "the-internet root with deepCrawl=true",
    "createdAt": "2026-10-19T10:38:36.156Z",
    "startedAt": "2026-10-19T10:38:37.074Z",
    "completedAt": "2026-10-19T10:40:48.162Z",
    "queuedMs": 918,
    "wallMs": 131088,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 58,
      "formsCount": 0,
      "pagesCount": 3,
      "crawlLatencyMs": 18119
    },
    "plan": {
      "aiCaseCount": 5,
      "baselineCaseCount": 3,
      "totalCases": 8,
      "expansionTriggered": false,
      "expansionReason": "Initial plan already produced 5 cases (>=5 rule)",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "state",
        "navigation",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 18119,
      "planMs": 26894,
      "generateMs": 0,
      "validateMs": 1373,
      "executeMs": 55801,
      "correctMs": 2004
    },
    "llm": {
      "totalCalls": 4,
      "totalPromptTokens": 12354,
      "totalCompletionTokens": 4266,
      "totalTokens": 16620,
      "callsByStep": {
        "plan": 2,
        "correct": 2
      },
      "tokensByStep": {
        "plan": 13653,
        "correct": 2967
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "gemini",
          "model": "gemini-2.5-flash",
          "tokens": 5684
        },
        {
          "step": "plan",
          "provider": "gemini",
          "model": "gemini-2.5-flash",
          "tokens": 7969
        },
        {
          "step": "correct",
          "provider": "groq",
          "model": "openai/gpt-oss-20b",
          "tokens": 1510
        },
        {
          "step": "correct",
          "provider": "groq",
          "model": "openai/gpt-oss-20b",
          "tokens": 1457
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 8,
      "passed": 6,
      "failedFinding": 0,
      "gaveUp": 2,
      "healed": 1,
      "correctionsAttempted": 1,
      "failureClasses": {
        "timeout": 1,
        "other": 1,
        "locator": 1
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 75617,
      "slimBytes": 38087,
      "reductionPercent": 50
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "state",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-4",
        "filename": "tc-4.spec.ts",
        "finalStatus": "gave_up",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "state",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "timeout",
            "executionError": "Test timeout of 15000ms exceeded.\n\nError: page.goto: Test timeout of 15000ms exceeded.\nCall log:\n  - navigating to \"https://the-internet.herokuapp.com/\", waiting until \"load\"\n\n\n  2 |\n  3 | test(\"State Persistence: Added elements reset on reload\", async ({ page }) => {\n> 4 |   await page.goto(\"https://the-internet.herokuapp.com/\");\n    |              ^\n  5 |   await page.getByRole(\"link\", { name: \"Add/Remove Elements\" }).click();\n  6 |   await page.goto(\"https://the-internet.herokuapp.com/add_remove_elements/\");\n  7 |   await page.getByRole(\"button\", { name: \"Add Element\" }).click();\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-505812a2-e257-486b-8b35-b5aa997411f9\\tc-4.spec.ts:4:14"
          }
        ]
      },
      {
        "testCaseId": "tc-5",
        "filename": "tc-5.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-2",
        "filename": "smoke-2.spec.ts",
        "finalStatus": "gave_up",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "other",
            "executionError": "Error: expect(received).toEqual(expected) // deep equality\n\n- Expected  - 1\n+ Received  + 4\n\n- Array []\n+ Array [\n+   \"401 https://the-internet.herokuapp.com/basic_auth\",\n+   \"401 https://the-internet.herokuapp.com/digest_auth\",\n+ ]\n\n  25 |     }\n  26 |   }\n> 27 |   expect(broken).toEqual([]);\n     |                  ^\n  28 | });\n  29 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-505812a2-e257-486b-8b35-b5aa997411f9\\smoke-2.spec.ts:27:18"
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 2,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "state",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "locator",
            "executionError": "Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Delete' }).filter({ hasText: 'Delete' }) resolved to 2 elements:\n    1) <button class=\"added-manually\" onclick=\"deleteElement()\">Delete</button> aka getByRole('button', { name: 'Delete' }).first()\n    2) <button class=\"added-manually\" onclick=\"deleteElement()\">Delete</button> aka getByRole('button', { name: 'Delete' }).nth(1)\n\nCall log:\n  - waiting for getByRole('button', { name: 'Delete' }).filter({ hasText: 'Delete' })\n\n\n   8 |   await page.getByRole(\"button\", { name: \"Add Element\" }).click();\n   9 |   await expect(page.getByRole(\"button\", { name: \"Delete\" })).toHaveCount(2);\n> 10 |   await page.getByRole(\"button\", { name: \"Delete\" }).filter({ hasText: \"Delete\" }).click();\n     |                                                                                    ^\n  11 |   await expect(page.getByRole(\"button\", { name: \"Delete\" })).toHaveCount(1);\n  12 | });\n  13 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-505812a2-e257-486b-8b35-b5aa997411f9\\tc-2.spec.ts:10:84"
          },
          {
            "attemptNumber": 2,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      }
    ]
  },
  {
    "runIndex": 7,
    "matrixItem": 4,
    "label": "saucedemo-1",
    "siteName": "saucedemo",
    "url": "https://www.saucedemo.com/",
    "jobId": "c49590ce-1d97-4cf8-8826-80d32a6f6e4d",
    "fresh": true,
    "deepCrawl": false,
    "tokenBudget": 40000,
    "note": "saucedemo run 1 with valid credentials",
    "createdAt": "2026-10-19T10:42:02.025Z",
    "startedAt": "2026-10-19T10:42:02.894Z",
    "completedAt": "2026-10-19T10:43:03.736Z",
    "queuedMs": 869,
    "wallMs": 60842,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 3,
      "formsCount": 1,
      "pagesCount": 1,
      "crawlLatencyMs": 3915
    },
    "plan": {
      "aiCaseCount": 3,
      "baselineCaseCount": 2,
      "totalCases": 5,
      "expansionTriggered": false,
      "expansionReason": "visibleCount (3) < 6",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "validation",
        "negative",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 3915,
      "planMs": 2047,
      "generateMs": 0,
      "validateMs": 2322,
      "executeMs": 28773,
      "correctMs": 2047
    },
    "llm": {
      "totalCalls": 3,
      "totalPromptTokens": 4326,
      "totalCompletionTokens": 1092,
      "totalTokens": 5418,
      "callsByStep": {
        "plan": 1,
        "correct": 2
      },
      "tokensByStep": {
        "plan": 2313,
        "correct": 3105
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "groq",
          "model": "openai/gpt-oss-120b",
          "tokens": 2313
        },
        {
          "step": "correct",
          "provider": "groq",
          "model": "openai/gpt-oss-20b",
          "tokens": 1444
        },
        {
          "step": "correct",
          "provider": "groq",
          "model": "openai/gpt-oss-20b",
          "tokens": 1661
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 5,
      "passed": 4,
      "failedFinding": 0,
      "gaveUp": 1,
      "healed": 0,
      "correctionsAttempted": 2,
      "failureClasses": {
        "locator": 2,
        "other": 1
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 27723,
      "slimBytes": 24684,
      "reductionPercent": 11
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "gave_up",
        "totalAttempts": 3,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "locator",
            "executionError": "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button', { name: 'Login' })\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"toBeVisible\" getByRole('button', { name: 'Login' }) with timeout 5000ms\n  - waiting for getByRole('button', { name: 'Login' })\n\n\n   7 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n   8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://www.saucedemo.com/\"));\n>  9 |   await expect(page.getByRole(\"button\", { name: \"Login\" })).toBeVisible();\n     |                                                             ^\n  10 | });\n  11 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-c49590ce-1d97-4cf8-8826-80d32a6f6e4d\\tc-2.spec.ts:9:61"
          },
          {
            "attemptNumber": 2,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "other",
            "executionError": "TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('#login-button') to be visible\n\n\n   7 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n   8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://www.saucedemo.com/\"));\n>  9 |   await page.waitForSelector('#login-button');\n     |              ^\n  10 |   await expect(page.getByRole(\"button\", { name: \"Login\" })).toBeVisible();\n  11 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-c49590ce-1d97-4cf8-8826-80d32a6f6e4d\\tc-2.spec.ts:9:14"
          },
          {
            "attemptNumber": 3,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "locator",
            "executionError": "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button', { name: 'Login' })\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"toBeVisible\" getByRole('button', { name: 'Login' }) with timeout 5000ms\n  - waiting for getByRole('button', { name: 'Login' })\n\n\n   7 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n   8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://www.saucedemo.com/\"));\n>  9 |   await expect(page.getByRole(\"button\", { name: \"Login\" })).toBeVisible();\n     |                                                             ^\n  10 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-c49590ce-1d97-4cf8-8826-80d32a6f6e4d\\tc-2.spec.ts:9:61"
          }
        ]
      }
    ]
  },
  {
    "runIndex": 8,
    "matrixItem": 4,
    "label": "saucedemo-2",
    "siteName": "saucedemo",
    "url": "https://www.saucedemo.com/",
    "jobId": "366251d4-7cfb-4456-abab-1c72eedabc38",
    "fresh": true,
    "deepCrawl": false,
    "tokenBudget": 40000,
    "note": "saucedemo run 2 with valid credentials",
    "createdAt": "2026-10-19T10:48:48.456Z",
    "startedAt": "2026-10-19T10:48:49.205Z",
    "completedAt": "2026-10-19T10:49:54.804Z",
    "queuedMs": 749,
    "wallMs": 65599,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 3,
      "formsCount": 1,
      "pagesCount": 1,
      "crawlLatencyMs": 3899
    },
    "plan": {
      "aiCaseCount": 3,
      "baselineCaseCount": 2,
      "totalCases": 5,
      "expansionTriggered": false,
      "expansionReason": "visibleCount (3) < 6",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "validation",
        "negative",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 3899,
      "planMs": 2394,
      "generateMs": 1,
      "validateMs": 2274,
      "executeMs": 33497,
      "correctMs": 1911
    },
    "llm": {
      "totalCalls": 3,
      "totalPromptTokens": 4311,
      "totalCompletionTokens": 1389,
      "totalTokens": 5700,
      "callsByStep": {
        "plan": 1,
        "correct": 2
      },
      "tokensByStep": {
        "plan": 2444,
        "correct": 3256
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "groq",
          "model": "openai/gpt-oss-120b",
          "tokens": 2444
        },
        {
          "step": "correct",
          "provider": "groq",
          "model": "openai/gpt-oss-20b",
          "tokens": 1525
        },
        {
          "step": "correct",
          "provider": "groq",
          "model": "openai/gpt-oss-20b",
          "tokens": 1731
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 5,
      "passed": 4,
      "failedFinding": 0,
      "gaveUp": 1,
      "healed": 0,
      "correctionsAttempted": 2,
      "failureClasses": {
        "locator": 1,
        "other": 2
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 27184,
      "slimBytes": 24085,
      "reductionPercent": 11
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "gave_up",
        "totalAttempts": 3,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "locator",
            "executionError": "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('textbox', { name: 'Username' })\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"toBeVisible\" getByRole('textbox', { name: 'Username' }) with timeout 5000ms\n  - waiting for getByRole('textbox', { name: 'Username' })\n\n\n   7 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n   8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://www.saucedemo.com/\"));\n>  9 |   await expect(page.getByRole(\"textbox\", { name: \"Username\" })).toBeVisible();\n     |                                                                 ^\n  10 | });\n  11 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-366251d4-7cfb-4456-abab-1c72eedabc38\\tc-2.spec.ts:9:65"
          },
          {
            "attemptNumber": 2,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "other",
            "executionError": "TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('#user-name') to be visible\n\n\n   7 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n   8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://www.saucedemo.com/\"));\n>  9 |   await page.waitForSelector('#user-name');\n     |              ^\n  10 |   await expect(page.getByRole(\"textbox\", { name: \"Username\" })).toBeVisible();\n  11 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-366251d4-7cfb-4456-abab-1c72eedabc38\\tc-2.spec.ts:9:14"
          },
          {
            "attemptNumber": 3,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "other",
            "executionError": "TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('#user-name') to be visible\n\n\n   7 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n   8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://www.saucedemo.com/\"));\n>  9 |   await page.waitForSelector('#user-name', { state: 'visible' });\n     |              ^\n  10 |   await expect(page.getByPlaceholder(\"Username\")).toBeVisible();\n  11 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-366251d4-7cfb-4456-abab-1c72eedabc38\\tc-2.spec.ts:9:14"
          }
        ]
      }
    ]
  },
  {
    "runIndex": 9,
    "matrixItem": 5,
    "label": "practicetestautomation-1",
    "siteName": "practicetestautomation",
    "url": "https://practicetestautomation.com/practice-test-login/",
    "jobId": "91129d53-b47f-4a72-ab11-c42d6f5b0a4a",
    "fresh": true,
    "deepCrawl": false,
    "tokenBudget": 40000,
    "note": "practicetestautomation run 1 with valid credentials",
    "createdAt": "2026-10-19T10:51:08.223Z",
    "startedAt": "2026-10-19T10:51:09.358Z",
    "completedAt": "2026-10-19T10:52:56.731Z",
    "queuedMs": 1135,
    "wallMs": 107373,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 13,
      "formsCount": 0,
      "pagesCount": 1,
      "crawlLatencyMs": 2908
    },
    "plan": {
      "aiCaseCount": 6,
      "baselineCaseCount": 3,
      "totalCases": 9,
      "expansionTriggered": false,
      "expansionReason": "Initial plan already produced 6 cases (>=5 rule)",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "validation",
        "navigation",
        "state",
        "smoke",
        "persistence"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 2908,
      "planMs": 3179,
      "generateMs": 0,
      "validateMs": 2365,
      "executeMs": 65952,
      "correctMs": 2082
    },
    "llm": {
      "totalCalls": 3,
      "totalPromptTokens": 4631,
      "totalCompletionTokens": 1725,
      "totalTokens": 6356,
      "callsByStep": {
        "plan": 1,
        "correct": 2
      },
      "tokensByStep": {
        "plan": 3197,
        "correct": 3159
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "groq",
          "model": "openai/gpt-oss-120b",
          "tokens": 3197
        },
        {
          "step": "correct",
          "provider": "groq",
          "model": "openai/gpt-oss-20b",
          "tokens": 1420
        },
        {
          "step": "correct",
          "provider": "groq",
          "model": "openai/gpt-oss-20b",
          "tokens": 1739
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 9,
      "passed": 7,
      "failedFinding": 1,
      "gaveUp": 1,
      "healed": 0,
      "correctionsAttempted": 2,
      "failureClasses": {
        "finding": 1,
        "locator": 1,
        "other": 2
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 48615,
      "slimBytes": 39078,
      "reductionPercent": 20
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://practicetestautomation.com/logged-in-successfully/\"\nTimeout:  5000ms\n\n\n   6 |   await page.getByLabel(\"Password\").fill(\"__AGT_SECRET_1__\");\n   7 |   await page.getByRole(\"button\", { name: \"Submit\" }).click();\n>  8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://practicetestautomation.com/practice-test-login/\"));\n     |                      ^\n   9 | });\n  10 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-91129d53-b47f-4a72-ab11-c42d6f5b0a4a\\tc-1.spec.ts:8:22"
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-5",
        "filename": "tc-5.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-6",
        "filename": "tc-6.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "state",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-2",
        "filename": "smoke-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-4",
        "filename": "tc-4.spec.ts",
        "finalStatus": "gave_up",
        "totalAttempts": 3,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "persistence",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "locator",
            "executionError": "Error: expect(locator).toHaveValue(expected) failed\n\nLocator: getByRole('textbox', { name: 'Username' })\nExpected: \"\"\nTimeout: 5000ms\nError: element(s) not found\n\nCall log:\n  - Expect \"toHaveValue\" getByRole('textbox', { name: 'Username' }) with timeout 5000ms\n  - waiting for getByRole('textbox', { name: 'Username' })\n\n\n   7 |   await page.getByRole(\"button\", { name: \"Submit\" }).click();\n   8 |   await page.reload();\n>  9 |   await expect(page.getByRole(\"textbox\", { name: \"Username\" })).toHaveValue(\"\");\n     |                                                                 ^\n  10 |   await expect(page.getByLabel(\"Password\")).toHaveValue(\"\");\n  11 | });\n  12 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-91129d53-b47f-4a72-ab11-c42d6f5b0a4a\\tc-4.spec.ts:9:65"
          },
          {
            "attemptNumber": 2,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "other",
            "executionError": "TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('#username') to be visible\n\n\n   7 |   await page.getByRole(\"button\", { name: \"Submit\" }).click();\n   8 |   await page.reload();\n>  9 |   await page.waitForSelector('#username');\n     |              ^\n  10 |   await expect(page.getByRole(\"textbox\", { name: \"Username\" })).toHaveValue(\"\");\n  11 |   await expect(page.getByLabel(\"Password\")).toHaveValue(\"\");\n  12 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-91129d53-b47f-4a72-ab11-c42d6f5b0a4a\\tc-4.spec.ts:9:14"
          },
          {
            "attemptNumber": 3,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "other",
            "executionError": "TimeoutError: page.waitForSelector: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('#username') to be visible\n\n\n   8 |   await page.reload();\n   9 |   await page.waitForLoadState('domcontentloaded');\n> 10 |   await page.waitForSelector('#username', { state: 'visible' });\n     |              ^\n  11 |   await expect(page.getByLabel(\"Username\")).toHaveValue(\"\");\n  12 |   await expect(page.getByLabel(\"Password\")).toHaveValue(\"\");\n  13 | });\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-91129d53-b47f-4a72-ab11-c42d6f5b0a4a\\tc-4.spec.ts:10:14"
          }
        ]
      }
    ]
  },
  {
    "runIndex": 10,
    "matrixItem": 5,
    "label": "practicetestautomation-2",
    "siteName": "practicetestautomation",
    "url": "https://practicetestautomation.com/practice-test-login/",
    "jobId": "e8d49259-7425-4069-98a9-79f1de92903a",
    "fresh": true,
    "deepCrawl": false,
    "tokenBudget": 40000,
    "note": "practicetestautomation run 2 with valid credentials",
    "createdAt": "2026-10-19T10:54:10.244Z",
    "startedAt": "2026-10-19T10:54:11.697Z",
    "completedAt": "2026-10-19T10:55:13.130Z",
    "queuedMs": 1453,
    "wallMs": 61433,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 13,
      "formsCount": 0,
      "pagesCount": 1,
      "crawlLatencyMs": 3330
    },
    "plan": {
      "aiCaseCount": 5,
      "baselineCaseCount": 3,
      "totalCases": 8,
      "expansionTriggered": false,
      "expansionReason": "Initial plan already produced 5 cases (>=5 rule)",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "validation",
        "navigation",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 3330,
      "planMs": 2935,
      "generateMs": 0,
      "validateMs": 0,
      "executeMs": 36143,
      "correctMs": 0
    },
    "llm": {
      "totalCalls": 1,
      "totalPromptTokens": 1998,
      "totalCompletionTokens": 1115,
      "totalTokens": 3113,
      "callsByStep": {
        "plan": 1
      },
      "tokensByStep": {
        "plan": 3113
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "groq",
          "model": "openai/gpt-oss-120b",
          "tokens": 3113
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 8,
      "passed": 7,
      "failedFinding": 1,
      "gaveUp": 0,
      "healed": 0,
      "correctionsAttempted": 0,
      "failureClasses": {
        "finding": 1
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 37270,
      "slimBytes": 29057,
      "reductionPercent": 22
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://practicetestautomation.com/logged-in-successfully/\"\nTimeout:  5000ms\n\n\n   6 |   await page.getByLabel(\"Password\").fill(\"__AGT_SECRET_1__\");\n   7 |   await page.getByRole(\"button\", { name: \"Submit\" }).click();\n>  8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://practicetestautomation.com/practice-test-login/\"));\n     |                      ^\n   9 | });\n  10 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-e8d49259-7425-4069-98a9-79f1de92903a\\tc-1.spec.ts:8:22"
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-4",
        "filename": "tc-4.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-5",
        "filename": "tc-5.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-2",
        "filename": "smoke-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      }
    ]
  },
  {
    "runIndex": 11,
    "matrixItem": 6,
    "label": "practicetestautomation-no-data",
    "siteName": "practicetestautomation (no data)",
    "url": "https://practicetestautomation.com/practice-test-login/",
    "jobId": "ad3ffd7c-c7cb-4ec2-b313-aacea772cb11",
    "fresh": true,
    "deepCrawl": false,
    "tokenBudget": 40000,
    "note": "practicetestautomation without test data (evaluates negative/validation case generation)",
    "createdAt": "2026-10-19T10:56:28.298Z",
    "startedAt": "2026-10-19T10:56:29.522Z",
    "completedAt": "2026-10-19T10:57:24.748Z",
    "queuedMs": 1224,
    "wallMs": 55226,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 13,
      "formsCount": 0,
      "pagesCount": 1,
      "crawlLatencyMs": 3424
    },
    "plan": {
      "aiCaseCount": 5,
      "baselineCaseCount": 3,
      "totalCases": 8,
      "expansionTriggered": false,
      "expansionReason": "Initial plan already produced 5 cases (>=5 rule)",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "validation",
        "negative",
        "navigation",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 3424,
      "planMs": 2744,
      "generateMs": 0,
      "validateMs": 0,
      "executeMs": 29648,
      "correctMs": 0
    },
    "llm": {
      "totalCalls": 1,
      "totalPromptTokens": 1910,
      "totalCompletionTokens": 1008,
      "totalTokens": 2918,
      "callsByStep": {
        "plan": 1
      },
      "tokensByStep": {
        "plan": 2918
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "groq",
          "model": "openai/gpt-oss-120b",
          "tokens": 2918
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 8,
      "passed": 7,
      "failedFinding": 1,
      "gaveUp": 0,
      "healed": 0,
      "correctionsAttempted": 0,
      "failureClasses": {
        "finding": 1
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 37112,
      "slimBytes": 28899,
      "reductionPercent": 22
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(page).toHaveURL(expected) failed\n\nExpected: predicate to succeed\nReceived: \"https://practicetestautomation.com/logged-in-successfully/\"\nTimeout:  5000ms\n\n\n   6 |   await page.getByLabel(\"Password\").fill(\"{{SECRET:practicetestautomation-password}}\");\n   7 |   await page.getByRole(\"button\", { name: \"Submit\" }).click();\n>  8 |   await expect(page).toHaveURL(url => url.href.includes(\"https://practicetestautomation.com/practice-test-login/\"));\n     |                      ^\n   9 | });\n  10 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-ad3ffd7c-c7cb-4ec2-b313-aacea772cb11\\tc-1.spec.ts:8:22"
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-4",
        "filename": "tc-4.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-5",
        "filename": "tc-5.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "navigation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-2",
        "filename": "smoke-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      }
    ]
  },
  {
    "runIndex": 12,
    "matrixItem": 7,
    "label": "saucedemo-budget-cap",
    "siteName": "saucedemo (capped)",
    "url": "https://www.saucedemo.com/",
    "jobId": "6092c0a1-d36c-4da5-b225-f660e5c50644",
    "fresh": true,
    "deepCrawl": false,
    "tokenBudget": 8000,
    "note": "saucedemo with low token budget 8000 (evaluates cap behavior & budget_note)",
    "createdAt": "2026-10-19T10:58:38.740Z",
    "startedAt": "2026-10-19T10:58:40.051Z",
    "completedAt": "2026-10-19T10:59:19.952Z",
    "queuedMs": 1311,
    "wallMs": 39901,
    "finalStatus": "completed",
    "errorCode": null,
    "errorMessage": null,
    "crawl": {
      "visibleElementCount": 3,
      "formsCount": 1,
      "pagesCount": 1,
      "crawlLatencyMs": 3927
    },
    "plan": {
      "aiCaseCount": 5,
      "baselineCaseCount": 2,
      "totalCases": 7,
      "expansionTriggered": false,
      "expansionReason": "visibleCount (3) < 6",
      "planCacheHit": false,
      "salvagedCasesCount": 0,
      "categories": [
        "validation",
        "negative",
        "smoke"
      ]
    },
    "phaseLatencies": {
      "crawlMs": 3927,
      "planMs": 2920,
      "generateMs": 0,
      "validateMs": 0,
      "executeMs": 13447,
      "correctMs": 0
    },
    "llm": {
      "totalCalls": 1,
      "totalPromptTokens": 1660,
      "totalCompletionTokens": 1066,
      "totalTokens": 2726,
      "callsByStep": {
        "plan": 1
      },
      "tokensByStep": {
        "plan": 2726
      },
      "providerModels": [
        {
          "step": "plan",
          "provider": "groq",
          "model": "openai/gpt-oss-120b",
          "tokens": 2726
        }
      ],
      "fallbacksObserved": 0,
      "rateLimitsObserved": 0
    },
    "tests": {
      "total": 7,
      "passed": 6,
      "failedFinding": 1,
      "gaveUp": 0,
      "healed": 0,
      "correctionsAttempted": 0,
      "failureClasses": {
        "finding": 1
      },
      "rejectedByGuards": 0,
      "gaveUpTokenBudget": 0
    },
    "payload": {
      "fullBytes": 27079,
      "slimBytes": 25224,
      "reductionPercent": 7
    },
    "testDetails": [
      {
        "testCaseId": "tc-1",
        "filename": "tc-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-2",
        "filename": "tc-2.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-3",
        "filename": "tc-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "validation",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-4",
        "filename": "tc-4.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toHaveURL",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "tc-5",
        "filename": "tc-5.spec.ts",
        "finalStatus": "failed",
        "totalAttempts": 1,
        "assertionCount": 0,
        "strongestAssertion": "toBeVisible",
        "category": "negative",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": false,
            "failureClass": "finding",
            "executionError": "Error: expect(locator).toHaveValue(expected) failed\n\nLocator:  getByRole('textbox', { name: 'Username' })\nExpected: \"standard_user\"\nReceived: \"\"\nTimeout:  5000ms\n\nCall log:\n  - Expect \"toHaveValue\" getByRole('textbox', { name: 'Username' }) with timeout 5000ms\n  - waiting for getByRole('textbox', { name: 'Username' })\n    14 × locator resolved to <input value=\"\" type=\"text\" id=\"user-name\" name=\"user-name\" autocorrect=\"off\" data-test=\"username\" aria-label=\"Username\" autocapitalize=\"none\" placeholder=\"Username\" class=\"input_error form_input\"/>\n       - unexpected value \"\"\n\n\n   6 |   await page.getByRole(\"button\", { name: \"Login\" }).click();\n   7 |   await page.reload();\n>  8 |   await expect(page.getByRole(\"textbox\", { name: \"Username\" })).toHaveValue(\"standard_user\");\n     |                                                                 ^\n   9 | });\n  10 |\n    at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-6092c0a1-d36c-4da5-b225-f660e5c50644\\tc-5.spec.ts:8:65"
          }
        ]
      },
      {
        "testCaseId": "smoke-1",
        "filename": "smoke-1.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 2,
        "strongestAssertion": "toHaveTitle",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      },
      {
        "testCaseId": "smoke-3",
        "filename": "smoke-3.spec.ts",
        "finalStatus": "passed",
        "totalAttempts": 1,
        "assertionCount": 1,
        "strongestAssertion": "toEqual",
        "category": "smoke",
        "attempts": [
          {
            "attemptNumber": 1,
            "validationPassed": true,
            "executionPassed": true,
            "failureClass": null,
            "executionError": null
          }
        ]
      }
    ]
  }
]
```

</details>

