import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { callLlm } from '../src/llm/client.ts';
import { withRequestLlmKeys } from '../src/llm/requestKeys.ts';
import { checkProviderKey } from '../src/llm/keyCheck.ts';
import { compileTest, CompileError } from '../src/agent/steps/compiler.ts';
import { toPlannerView } from '../src/agent/plannerView.ts';
import { setCachedPlan, getCachedPlan, buildPlanCacheKey } from '../src/agent/planCache.ts';
import { capAndRenumberTestPlan, enforceTestData } from '../src/agent/steps/planner.ts';
import { resolveTestData } from '../src/agent/testData.ts';
import { redactSecrets } from '../src/runner/executor.ts';
import { correctionPreservesSecrets } from '../src/agent/assertionGuard.ts';
import { transformSecretTokens, exportProject } from '../src/export/projectExporter.ts';
import { childProcessEnv } from '../src/runner/childEnv.ts';
import { GenerateRequestSchema } from '../src/api/schemas.ts';
import { validateTestCode } from '../src/runner/validator.ts';
import { config } from '../src/config.ts';
import type { AppMap, InteractiveElement, AppForm } from '../src/crawler/types.ts';
import type { PlannedTestCase, TestPlan } from '../src/agent/prompts/plannerPrompt.ts';
import type { LoadedJob } from '../src/db/jobs.ts';

function createDummyElement(id: string, overrides: Partial<InteractiveElement> = {}): InteractiveElement {
  return {
    id,
    tagName: 'button',
    type: 'button',
    detectedBy: 'native',
    text: `Button ${id}`,
    isVisible: true,
    isEnabled: true,
    selectors: { css: `#${id}` },
    ...overrides,
  };
}

function createDummyAppMap(url: string, elements: InteractiveElement[] = [], forms: AppForm[] = []): AppMap {
  return {
    url,
    title: `Title for ${url}`,
    crawledAt: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    elements,
    forms,
    discoveredLinks: [],
    totalElementsFound: elements.length,
    isTruncated: false,
  };
}

async function runTests() {
  const originalFetch = globalThis.fetch;

  try {
    // =========================================================================
    // 1. Strict BYOK: bad Groq key in ALS + server Gemini key → throws; Gemini endpoint 0 calls
    // =========================================================================
    console.log('--- 1. Strict BYOK failure isolation ---');
    {
      const prevGemini = config.GEMINI_API_KEY;
      config.GEMINI_API_KEY = 'server-gemini-key-12345';
      let geminiCalls = 0;
      let groqCalls = 0;

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.includes('api.groq.com')) {
          groqCalls++;
          return new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('generativelanguage.googleapis.com')) {
          geminiCalls++;
          return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof globalThis.fetch;

      await assert.rejects(
        async () => {
          await withRequestLlmKeys({ groq: 'bad-groq-key' }, async () => {
            await callLlm({
              messages: [{ role: 'user', content: 'hello' }],
              maxTokens: 50,
            });
          });
        },
        /ALL_PROVIDERS_FAILED|AUTH_FAILED/,
      );

      assert.equal(geminiCalls, 0, 'Gemini server endpoint must receive ZERO calls when user provides BYOK keys');
      assert.ok(groqCalls >= 1, 'Groq endpoint must have been called');
      config.GEMINI_API_KEY = prevGemini;
    }

    // =========================================================================
    // 2. BYOK with valid-looking key: Authorization header equals the request key, never config key
    // =========================================================================
    console.log('--- 2. BYOK Authorization header fidelity ---');
    {
      let capturedAuth: string | null = null;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.includes('api.groq.com')) {
          const headers = new Headers(init?.headers);
          capturedAuth = headers.get('authorization');
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'test response' } }],
              usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return new Response('Not found', { status: 404 });
      }) as typeof globalThis.fetch;

      const userKey = 'gsk_test_user_provided_key_xyz_123';
      await withRequestLlmKeys({ groq: userKey }, async () => {
        const res = await callLlm({
          messages: [{ role: 'user', content: 'say test' }],
          maxTokens: 20,
        });
        assert.equal(res.content, 'test response');
      });

      assert.equal(capturedAuth, `Bearer ${userKey}`);
      if (config.GROQ_API_KEY) {
        assert.notEqual(capturedAuth, `Bearer ${config.GROQ_API_KEY}`);
      }
    }

    // =========================================================================
    // 3. checkProviderKey: 401 → invalid, 400 → invalid, 200 → valid, 500 → unknown; cache hit skips fetch
    // =========================================================================
    console.log('--- 3. checkProviderKey status mapping and caching ---');
    {
      let fetchCount = 0;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCount++;
        const headers = new Headers(init?.headers);
        const auth = headers.get('authorization') ?? '';

        if (auth.includes('key-401')) {
          return new Response('Unauthorized', { status: 401 });
        }
        if (auth.includes('key-400')) {
          return new Response('Bad Request', { status: 400 });
        }
        if (auth.includes('key-200')) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (auth.includes('key-500')) {
          return new Response('Server Error', { status: 500 });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof globalThis.fetch;

      const res401 = await checkProviderKey('groq', 'key-401');
      assert.equal(res401, 'invalid');

      const res400 = await checkProviderKey('gemini', 'key-400');
      assert.equal(res400, 'invalid');

      const res200 = await checkProviderKey('groq', 'key-200');
      assert.equal(res200, 'valid');

      const res500 = await checkProviderKey('groq', 'key-500');
      assert.equal(res500, 'unknown');

      // Cache hit test: checkProviderKey for key-200 again should use cached result and not call fetch
      const countBefore = fetchCount;
      const res200Cached = await checkProviderKey('groq', 'key-200');
      assert.equal(res200Cached, 'valid');
      assert.equal(fetchCount, countBefore, 'Cached keyCheck must skip fetch');
    }

    // =========================================================================
    // 4. compileTest: golden output for a case using all 9 actions; title with
    //    quotes/backticks/${} and a U+2028 char still tsc-validates; unknown elementId → CompileError
    // =========================================================================
    console.log('--- 4. compileTest: 9 actions, escaping, validation, and CompileError ---');
    {
      const elements: InteractiveElement[] = [
        createDummyElement('elem-btn', { type: 'button', selectors: { css: '#btn', getByRole: "getByRole('button', { name: 'Submit' })" } }),
        createDummyElement('elem-input', { type: 'input', selectors: { css: '#inp', getByPlaceholder: "getByPlaceholder('Enter text')" } }),
        createDummyElement('elem-select', { type: 'select', selectors: { css: '#sel', getByLabel: "getByLabel('Choose option')" } }),
        createDummyElement('elem-hover', { type: 'button', selectors: { css: '#hover-target', getByTestId: "getByTestId('hover-btn')" } }),
        createDummyElement('elem-text', { type: 'custom_interactive', selectors: { css: '.heading-text', getByText: "getByText('Welcome Back')" } }),
      ];

      const testCase: PlannedTestCase = {
        id: 'tc-golden-1',
        title: 'Golden test with "double", \'single\', `backticks`, ${interpolated} and \u2028 char',
        description: 'Comprehensive 9-action test case',
        steps: [
          { action: 'click', elementId: 'elem-btn', value: null, description: 'click submit' },
          { action: 'fill', elementId: 'elem-input', value: 'Hello world', description: 'fill text' },
          { action: 'select', elementId: 'elem-select', value: 'opt-1', description: 'select option' },
          { action: 'hover', elementId: 'elem-hover', value: null, description: 'hover element' },
          { action: 'press', elementId: 'elem-input', value: 'Enter', description: 'press enter' },
          { action: 'navigate', elementId: null, value: 'https://example.com/settings', description: 'navigate to settings' },
          { action: 'assert_visible', elementId: 'elem-hover', value: null, description: 'verify hover button visible' },
          { action: 'assert_visible', elementId: null, value: 'Dashboard', description: 'verify text visible' },
          { action: 'assert_text', elementId: 'elem-text', value: 'Welcome Back', description: 'verify element text' },
          { action: 'assert_url', elementId: null, value: '/settings', description: 'verify url' },
        ],
      };

      const compiled = compileTest(testCase, elements, 'https://example.com');
      assert.equal(compiled.filename, 'tc-golden-1.spec.ts');
      assert.ok(compiled.code.includes("import { test, expect } from '@playwright/test';"));
      assert.ok(compiled.code.includes('await page.goto("https://example.com");'));

      // Verify static validation with tsc
      const validation = await validateTestCode('scratch-compile-test', [
        { filename: compiled.filename, code: compiled.code },
      ]);
      assert.equal(validation.valid, true, `Validation failed: ${validation.errors.join('\n')}`);

      // Unknown elementId → CompileError
      const invalidCase: PlannedTestCase = {
        id: 'tc-bad-ref',
        title: 'Bad reference',
        description: 'References unknown element',
        steps: [{ action: 'click', elementId: 'elem-non-existent', value: null, description: 'missing' }],
      };
      assert.throws(() => compileTest(invalidCase, elements, 'https://example.com'), CompileError);
    }

    // =========================================================================
    // 5. toPlannerView on a synthetic 200-element map: length ≤ 35% of JSON.stringify(appMap); no "selectors"
    // =========================================================================
    console.log('--- 5. toPlannerView compact payload ---');
    {
      const synthElements: InteractiveElement[] = [];
      for (let i = 1; i <= 200; i++) {
        synthElements.push(
          createDummyElement(`elem-${i}`, {
            tagName: i % 2 === 0 ? 'BUTTON' : 'INPUT',
            type: i % 2 === 0 ? 'button' : 'input',
            detectedBy: 'native',
            isVisible: i % 4 !== 0, // 25% are hidden elements (menus, modals, tab panels)
            isRequired: false,
            isReadOnly: false,
            text: `Element label ${i} with very long descriptive text that exceeds eighty characters so that clip will truncate it properly`,
            placeholder: `Type something long and detailed into input field ${i} for test data generation`,
            ariaLabel: `Accessible label for element ${i} with detailed instructions for screen reader users`,
            selectors: {
              css: `html > body.theme-dark > div#app-root > main.main-content-layout > section.card-section:nth-child(2) > form.user-entry-form > div.form-row:nth-child(${i}) > input.form-control#input-field-${i}`,
              getByTestId: `getByTestId('entry-field-${i}')`,
              getByRole: `getByRole('button', { name: 'Accessible label for element ${i}' })`,
              getByPlaceholder: `getByPlaceholder('Type something long and detailed into input field ${i}')`,
              getByLabel: `getByLabel('Accessible label for element ${i}')`,
              getByText: `getByText('Element label ${i}')`,
            },
          }),
        );
      }
      const appMap = createDummyAppMap('https://example.com', synthElements, [
        {
          id: 'form-1',
          purpose: 'login',
          fieldIds: ['elem-1', 'elem-2'],
          submitButtonId: 'elem-4',
        },
      ]);

      const fullJson = JSON.stringify(appMap);
      const view = toPlannerView(appMap);
      const viewJson = JSON.stringify(view);

      assert.ok(!viewJson.includes('"selectors"'), 'Planner view must never include raw selectors map');
      const ratio = viewJson.length / fullJson.length;
      assert.ok(
        ratio <= 0.35,
        `Planner view (${viewJson.length} bytes) exceeds 35% of full map (${fullJson.length} bytes, ratio: ${(ratio * 100).toFixed(1)}%)`,
      );
    }

    // =========================================================================
    // 6. Pre-flight: groq skipped when est > 7500 and gemini available; NOT skipped when it is the only provider
    // =========================================================================
    console.log('--- 6. TPM pre-flight skipping ---');
    {
      const prevGemini = config.GEMINI_API_KEY;
      const prevGroq = config.GROQ_API_KEY;
      config.GROQ_API_KEY = 'groq-tpm-key';
      config.GEMINI_API_KEY = 'gemini-tpm-key';

      let groqCalls = 0;
      let geminiCalls = 0;

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.includes('api.groq.com')) {
          groqCalls++;
          return new Response(JSON.stringify({ choices: [{ message: { content: 'from groq' } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('generativelanguage.googleapis.com')) {
          geminiCalls++;
          return new Response(JSON.stringify({ choices: [{ message: { content: 'from gemini' } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      }) as typeof globalThis.fetch;

      // 25000 chars -> est tokens = ceil(25000 / 3.5) + 4096 = 7143 + 4096 = 11239 > 7500
      const largeMessage = 'a'.repeat(25000);

      // Case A: Both groq and gemini available -> Groq is skipped, Gemini called
      await callLlm({
        messages: [{ role: 'user', content: largeMessage }],
        maxTokens: 1000,
      });
      assert.equal(groqCalls, 0, 'Groq must be skipped when est > 7500 and another provider is available');
      assert.equal(geminiCalls, 1, 'Gemini must be called when Groq is skipped');

      // Case B: Groq is the ONLY provider (in ALS BYOK mode) -> Groq is NOT skipped even though est > 7500
      groqCalls = 0;
      geminiCalls = 0;
      await withRequestLlmKeys({ groq: 'user-groq-only-key' }, async () => {
        await callLlm({
          messages: [{ role: 'user', content: largeMessage }],
          maxTokens: 1000,
        });
      });
      assert.equal(groqCalls, 1, 'Groq must NOT be skipped when it is the sole provider');
      assert.equal(geminiCalls, 0);

      config.GROQ_API_KEY = prevGroq;
      config.GEMINI_API_KEY = prevGemini;
    }

    // =========================================================================
    // 7. planCache: hit returns a deep clone (mutating it doesn't affect the next hit)
    // =========================================================================
    console.log('--- 7. planCache deep-clone isolation ---');
    {
      const cacheKey = buildPlanCacheKey({ view: { sample: 'view' } });
      const originalPlan: TestPlan = {
        testCases: [
          {
            id: 'tc-1',
            title: 'Original Title',
            description: 'Original Description',
            steps: [{ action: 'click', elementId: 'elem-1', value: null, description: 'click' }],
          },
        ],
      };

      setCachedPlan(cacheKey, originalPlan);
      const hit1 = getCachedPlan(cacheKey);
      assert.ok(hit1);
      assert.equal(hit1.testCases[0].title, 'Original Title');

      // Mutate the returned clone
      hit1.testCases[0].title = 'Mutated Title';
      hit1.testCases.push({
        id: 'tc-mutated',
        title: 'New Case',
        description: 'New',
        steps: [],
      });

      // Next hit should be untouched
      const hit2 = getCachedPlan(cacheKey);
      assert.ok(hit2);
      assert.equal(hit2.testCases[0].title, 'Original Title');
      assert.equal(hit2.testCases.length, 1);
    }

    // =========================================================================
    // 8. MAX_TEST_CASES truncation + renumbering
    // =========================================================================
    console.log('--- 8. MAX_TEST_CASES (6) cap and renumbering ---');
    {
      const excessivePlan: TestPlan = {
        testCases: Array.from({ length: 9 }, (_, i) => ({
          id: `case-${i + 1}`,
          title: `Test Case ${i + 1}`,
          description: `Desc ${i + 1}`,
          steps: [],
        })),
      };

      const capped = capAndRenumberTestPlan(excessivePlan);
      assert.equal(capped.testCases.length, 6);
      assert.deepEqual(
        capped.testCases.map((tc) => tc.id),
        ['tc-1', 'tc-2', 'tc-3', 'tc-4', 'tc-5', 'tc-6'],
      );
    }

    // =========================================================================
    // 9. resolveTestData: tokens assigned, fills enforced on a plan that ignored them, secret asserts removed
    // =========================================================================
    console.log('--- 9. resolveTestData and enforceTestData ---');
    {
      const appMap = createDummyAppMap('https://example.com', [
        createDummyElement('elem-email', { type: 'input', selectors: { css: '#email' } }),
        createDummyElement('elem-password', { type: 'input', selectors: { css: '#pwd' } }),
      ]);

      const testDataInput = [
        { elementId: 'elem-email', css: '#email', value: 'qa@example.com', sensitive: false },
        { elementId: 'elem-password', css: '#pwd', value: 'MySecretP@ssword123', sensitive: true },
      ];

      const resolved = resolveTestData(appMap, testDataInput);
      assert.equal(resolved.fills.get('elem-email'), 'qa@example.com');
      const secretToken = resolved.fills.get('elem-password');
      assert.ok(secretToken && secretToken.startsWith('__AGT_SECRET_'));
      assert.equal(resolved.secrets.get(secretToken), 'MySecretP@ssword123');

      // Build a plan where LLM generated hallucinated values and placed secret in assert step
      const untrustedPlan: TestPlan = {
        testCases: [
          {
            id: 'tc-1',
            title: 'Login',
            description: 'Login test',
            steps: [
              { action: 'fill', elementId: 'elem-email', value: 'wrong@example.com', description: 'fill email' },
              { action: 'fill', elementId: 'elem-password', value: 'wrong_secret', description: 'fill pwd' },
              { action: 'assert_text', elementId: 'elem-password', value: secretToken, description: 'assert leaked secret' },
              { action: 'assert_visible', elementId: 'elem-email', value: null, description: 'visible' },
            ],
          },
        ],
      };

      const enforced = enforceTestData(untrustedPlan, resolved.fills);
      const steps = enforced.testCases[0].steps;
      assert.equal(steps[0].value, 'qa@example.com');
      assert.equal(steps[1].value, secretToken);
      // Secret assert must be removed
      assert.equal(steps.length, 3);
      assert.equal(steps[2].action, 'assert_visible');
    }

    // =========================================================================
    // 10. executor redaction: a fake error containing the secret and its JSON-escaped form → only tokens remain
    // =========================================================================
    console.log('--- 10. executor secret redaction ---');
    {
      const secret = 'p@ss"word\\slash\nnewline';
      const secretsMap = new Map([['__AGT_SECRET_1__', secret]]);
      const jsonEscaped = JSON.stringify(secret).slice(1, -1);

      const fakeOutput = `Error: expected input to contain "${jsonEscaped}" but received raw ${secret}`;
      const redacted = redactSecrets(fakeOutput, secretsMap);

      assert.ok(!redacted.includes(secret), 'Raw secret must not remain in error output');
      assert.ok(!redacted.includes(jsonEscaped), 'JSON-escaped secret must not remain in error output');
      assert.ok(redacted.includes('__AGT_SECRET_1__'));
    }

    // =========================================================================
    // 11. correctionPreservesSecrets true/false cases
    // =========================================================================
    console.log('--- 11. correctionPreservesSecrets guard ---');
    {
      const prevCode = `
        test('login', async ({ page }) => {
          await page.fill('#user', '__AGT_SECRET_1__');
          await page.fill('#pass', '__AGT_SECRET_2__');
        });
      `;
      const validCorrection = `
        test('login', async ({ page }) => {
          await page.locator('#user').fill('__AGT_SECRET_1__');
          await page.locator('#pass').fill('__AGT_SECRET_2__');
        });
      `;
      const invalidCorrection = `
        test('login', async ({ page }) => {
          await page.locator('#user').fill('__AGT_SECRET_1__');
          await page.locator('#pass').fill('plain_password');
        });
      `;

      assert.equal(correctionPreservesSecrets(prevCode, validCorrection), true);
      assert.equal(correctionPreservesSecrets(prevCode, invalidCorrection), false);
    }

    // =========================================================================
    // 12. Exporter: token → process.env.AGT_SECRET_1 ?? '' and .env.example present
    // =========================================================================
    console.log('--- 12. projectExporter transform and .env.example ---');
    {
      const codeWithSecret = `
        await page.fill('#u', '__AGT_SECRET_1__');
        await page.fill('#p', "__AGT_SECRET_2__");
      `;
      const { code, tokens } = transformSecretTokens(codeWithSecret);
      assert.deepEqual(tokens, ['AGT_SECRET_1', 'AGT_SECRET_2']);
      assert.ok(code.includes("(process.env.AGT_SECRET_1 ?? '')"));
      assert.ok(code.includes("(process.env.AGT_SECRET_2 ?? '')"));

      const dummyJob: LoadedJob = {
        id: '00000000-0000-0000-0000-000000000001',
        targetUrl: 'https://example.com',
        deepCrawl: false,
        status: 'completed',
        usedOwnKeys: false,
        visitorId: null,
        errorMessage: null,
        createdAt: new Date(),
        completedAt: new Date(),
        appMap: null,
        testPlan: null,
        agentSteps: [],
        generatedTests: [
          {
            id: 't-1',
            jobId: '00000000-0000-0000-0000-000000000001',
            testCaseId: 'tc-1',
            filename: 'tc-1.spec.ts',
            finalCode: `import { test } from '@playwright/test'; test('t', async ({page}) => { await page.fill('#p', '__AGT_SECRET_1__'); });`,
            finalStatus: 'passed',
            totalAttempts: 1,
            confidence: null,
            executionResults: [],
          },
        ],
      };

      const chunks: Buffer[] = [];
      const pass = new PassThrough();
      pass.on('data', (c) => chunks.push(c));

      await exportProject(dummyJob, pass);
      const zipBuffer = Buffer.concat(chunks);
      // In a zip archive, entry names are stored in clear text
      const zipString = zipBuffer.toString('latin1');
      assert.ok(zipString.includes('.env.example'), 'Export zip must contain .env.example when secrets exist');
    }

    // =========================================================================
    // 13. HEADED_DEBUG unset → childProcessEnv().HEADLESS === 'true'
    // =========================================================================
    console.log('--- 13. HEADED_DEBUG unset defaults to headless ---');
    {
      const env = childProcessEnv();
      assert.equal(env.HEADLESS, 'true');
    }

    // =========================================================================
    // 14. GenerateRequestSchema accepts testData/focus, rejects 31 entries / 6 focus refs / bad elementId
    // =========================================================================
    console.log('--- 14. GenerateRequestSchema validation bounds ---');
    {
      const validEntry = { elementId: 'elem-1', css: '#input', value: 'test', sensitive: false };
      const validFocus = { elementId: 'elem-tab', css: '#tab' };

      // Valid requests
      const parsed1 = GenerateRequestSchema.safeParse({
        url: 'https://example.com',
        testData: [validEntry],
        focus: [validFocus],
      });
      assert.ok(parsed1.success, 'Valid single-url request with testData and focus must pass');

      const parsed2 = GenerateRequestSchema.safeParse({
        urls: ['https://example.com', 'https://example.com/about'],
        testData: [validEntry],
        focus: [validFocus],
      });
      assert.ok(parsed2.success, 'Valid multi-url request with testData and focus must pass');

      // Rejects 31 testData entries (max 30)
      const parsed31 = GenerateRequestSchema.safeParse({
        url: 'https://example.com',
        testData: Array.from({ length: 31 }, (_, i) => ({
          elementId: `elem-${i}`,
          css: `#input-${i}`,
          value: 'test',
          sensitive: false,
        })),
      });
      assert.equal(parsed31.success, false, '31 testData entries must be rejected');

      // Rejects 6 focus refs (max 5)
      const parsedFocus6 = GenerateRequestSchema.safeParse({
        url: 'https://example.com',
        focus: Array.from({ length: 6 }, (_, i) => ({
          elementId: `elem-${i}`,
          css: `#tab-${i}`,
        })),
      });
      assert.equal(parsedFocus6.success, false, '6 focus refs must be rejected');

      // Rejects bad elementId
      const parsedBadId = GenerateRequestSchema.safeParse({
        url: 'https://example.com',
        testData: [{ elementId: 'bad id with spaces!', css: '#inp', value: 'v', sensitive: false }],
      });
      assert.equal(parsedBadId.success, false, 'Bad elementId regex must be rejected');
    }

    console.log('\nAll 14 testPhase12 assertions passed successfully!\n');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runTests().catch((err) => {
  console.error('\nTest phase 12 failed with error:\n', err);
  process.exit(1);
});
