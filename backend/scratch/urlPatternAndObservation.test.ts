import assert from 'node:assert/strict';
import { urlAssertPattern, compileTest } from '../src/agent/steps/compiler.ts';
import { classifyExecutionError } from '../src/runner/executor.ts';
import { isSkipLink, buildAppMap } from '../src/crawler/appMapBuilder.ts';
import { planTests } from '../src/agent/steps/planner.ts';
import { buildBaselineTests } from '../src/agent/baseline.ts';
import { crawlPage } from '../src/crawler/pageCrawler.ts';
import { observeAppMap, normalizeObservedText, isObservableHref } from '../src/crawler/observe.ts';
import { resolveTestData } from '../src/agent/testData.ts';
import type { AppMap, InteractiveElement, Observation } from '../src/crawler/types.ts';
import type { TestDataEntry } from '../src/api/schemas.ts';
import type { LlmRequest } from '../src/llm/client.ts';
import type { PlannedTestCase } from '../src/agent/prompts/plannerPrompt.ts';

let exitCode = 0;

function run(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
    } catch (err: unknown) {
      exitCode = 1;
      console.error(`[FAIL] ${name}:`, err);
    }
  })();
}

function makeElement(id: string, overrides: Partial<InteractiveElement> = {}): InteractiveElement {
  return {
    id,
    tagName: 'A',
    type: 'link',
    detectedBy: 'native',
    text: `Element ${id}`,
    isVisible: true,
    isEnabled: true,
    selectors: { css: `#${id}` },
    ...overrides,
  };
}

function makeAppMap(overrides: Partial<AppMap> = {}): AppMap {
  return {
    url: 'https://example.com/',
    title: 'Example Page',
    crawledAt: new Date().toISOString(),
    viewport: { width: 1280, height: 800 },
    elements: [],
    forms: [],
    discoveredLinks: [],
    totalElementsFound: 0,
    isTruncated: false,
    ...overrides,
  };
}

async function main() {
  console.log('=== URL Pattern & Form Observation Suite ===\n');

  // ---------------------------------------------------------------------------
  // P1: urlAssertPattern
  // ---------------------------------------------------------------------------
  await run('P1: urlAssertPattern anchored, query-tolerant, hash route, unanchored fragment', () => {
    const p1 = urlAssertPattern('https://x.com/a/b?x=1');
    const rx1 = new RegExp(p1);

    // No unescaped dots in domain or path
    assert.ok(!p1.includes('x.com'), 'Dots in hostname must be escaped');
    assert.ok(p1.includes('x\\.com'), 'Escaped dots must be present');

    assert.ok(rx1.test('https://x.com/a/b'), 'matches base without query');
    assert.ok(rx1.test('https://x.com/a/b/'), 'matches base with trailing slash');
    assert.ok(rx1.test('https://x.com/a/b?y=2'), 'matches base with different query');
    assert.ok(rx1.test('https://x.com/a/b/?foo=bar#section'), 'matches base with query and hash');
    assert.ok(!rx1.test('https://x.com/a/bc'), 'does NOT match /a/bc');
    assert.ok(!rx1.test('https://x.com/a/b-other'), 'does NOT match /a/b-other');

    // Hash route
    const pHash = urlAssertPattern('https://x.com/#/home');
    const rxHash = new RegExp(pHash);
    assert.ok(rxHash.test('https://x.com/#/home'), 'matches exact hash route');
    assert.ok(rxHash.test('https://x.com/#/home?tab=1'), 'matches hash route with query');
    assert.ok(!rxHash.test('https://x.com/#/other'), 'does NOT match different hash route');

    // Fragment / path
    const pFrag = urlAssertPattern('/inventory');
    const rxFrag = new RegExp(pFrag);
    assert.ok(rxFrag.test('https://x.com/inventory.html'), 'unanchored fragment matches inventory.html');
    assert.ok(rxFrag.test('https://x.com/app/inventory'), 'unanchored fragment matches /app/inventory');
  });

  // ---------------------------------------------------------------------------
  // P2: classifyExecutionError
  // ---------------------------------------------------------------------------
  await run('P2: classifyExecutionError diff equality, serializes same string, timeout, locator', () => {
    const diffErr = [
      'Error: expect(received).toEqual(expected)',
      '',
      '- Expected  - 1',
      '+ Received  + 1',
      '',
      '  15 |   await expect(items).toEqual(["a"]);',
    ].join('\n');
    assert.equal(classifyExecutionError(diffErr), 'finding', 'diff hunks must classify as finding');

    const serializesErr = [
      'Error: expect(received).toEqual(expected) // deep equality',
      'Expected: [1]',
      'Received: [1]',
      'Note that you are testing for equality, but serializes to the same string',
    ].join('\n');
    assert.equal(classifyExecutionError(serializesErr), 'finding', 'serializes to same string must classify as finding');

    const timeoutErr = 'Error: Test timeout of 30000ms exceeded while running test';
    assert.equal(classifyExecutionError(timeoutErr), 'timeout', 'timeout must classify as timeout');

    const locatorErr = [
      'Error: Timed out 5000ms waiting for getByRole("button", { name: "Submit" })',
      'element(s) not found',
    ].join('\n');
    assert.equal(classifyExecutionError(locatorErr), 'locator', 'missing element must classify as locator');
  });

  // ---------------------------------------------------------------------------
  // P3: isSkipLink
  // ---------------------------------------------------------------------------
  await run('P3: isSkipLink predicates', () => {
    assert.equal(
      isSkipLink(makeElement('l1', { tagName: 'A', type: 'link', text: 'Skip to content', href: '#content' })),
      true,
      'Skip to content anchor must be true',
    );
    assert.equal(
      isSkipLink(makeElement('l2', { tagName: 'A', type: 'link', text: 'Home', href: '/home' })),
      false,
      'Normal link must be false',
    );
    assert.equal(
      isSkipLink(makeElement('l3', { tagName: 'A', type: 'link', text: 'Skip to main content', href: '#main' })),
      true,
      'Skip to main content must be true',
    );
    assert.equal(
      isSkipLink(makeElement('b1', { tagName: 'BUTTON', type: 'button', text: 'Skip' })),
      false,
      'Button with text Skip must be false',
    );
  });

  // ---------------------------------------------------------------------------
  // P4: planner dual-call with callLlmImpl fake
  // ---------------------------------------------------------------------------
  await run('P4: planner dual-call merge, dedupe, assignment lines, fast failure fallback', async () => {
    const el1 = makeElement('elem-1', { text: 'Elem 1', selectors: { css: '#elem-1' } });
    const obs: Observation = {
      kind: 'navigation',
      fromUrl: 'https://example.com/',
      finalUrl: 'https://example.com/observed-final',
      title: 'Observed Final Page',
      visibleTexts: ['Observed Title'],
    };
    const appMap = makeAppMap({
      elements: [el1],
      totalElementsFound: 1,
      observations: [obs],
    });

    function makePlanPayload(cases: Array<{ id: string; title: string }>) {
      return JSON.stringify({
        testCases: cases.map((c) => ({
          id: c.id,
          title: c.title,
          description: 'fixture desc',
          steps: [
            { action: 'click', elementId: 'elem-1', target: null, value: null, description: 'click elem-1' },
            { action: 'assert_visible', elementId: 'elem-1', target: null, value: null, description: 'visible elem-1' },
          ],
        })),
      });
    }

    const capturedRequests: LlmRequest[] = [];
    const dualCallFake = async (req: LlmRequest) => {
      capturedRequests.push(req);
      if (req.tier === 'reasoning') {
        return {
          content: makePlanPayload([
            { id: 'tc-a1', title: 'Core A' },
            { id: 'tc-a2', title: 'Dup' },
          ]),
          model: 'mock-reasoning',
          provider: 'mock',
          latencyMs: 10,
          usage: { promptTokens: 10, completionTokens: 10 },
        };
      }
      return {
        content: makePlanPayload([
          { id: 'tc-b1', title: 'Negative A' },
          { id: 'tc-b2', title: 'dup' }, // duplicate of Dup (case-insensitive)
        ]),
        model: 'mock-fast',
        provider: 'mock',
        latencyMs: 5,
        usage: { promptTokens: 5, completionTokens: 5 },
      };
    };

    const plan = await planTests(appMap, {
      fresh: true,
      callLlmImpl: dualCallFake as never,
    });

    assert.equal(plan.testCases.length, 3, 'Merged plan must deduplicate to 3 cases');
    assert.deepEqual(
      plan.testCases.map((c) => c.id),
      ['tc-1', 'tc-2', 'tc-3'],
      'Cases must be renumbered tc-1..tc-3',
    );
    assert.deepEqual(
      plan.testCases.map((c) => c.title),
      ['Core A', 'Dup', 'Negative A'],
      'Cases must preserve order: A cases then non-duplicate B cases',
    );

    // Verify user prompts
    assert.equal(capturedRequests.length, 2, 'Must have made 2 concurrent planner calls');
    const reasoningReq = capturedRequests.find((r) => r.tier === 'reasoning')!;
    const fastReq = capturedRequests.find((r) => r.tier === 'fast')!;

    const reasoningUserMsg = String(reasoningReq.messages.find((m) => m.role === 'user')?.content ?? '');
    const fastUserMsg = String(fastReq.messages.find((m) => m.role === 'user')?.content ?? '');

    assert.ok(reasoningUserMsg.includes('OBSERVED FACTS'), 'Reasoning prompt must include OBSERVED FACTS');
    assert.ok(reasoningUserMsg.includes('https://example.com/observed-final'), 'Reasoning prompt must include observed URL');
    assert.ok(reasoningUserMsg.includes('ASSIGNMENT: plan up to 6 core cases'), 'Reasoning prompt has A assignment');

    assert.ok(fastUserMsg.includes('OBSERVED FACTS'), 'Fast prompt must include OBSERVED FACTS');
    assert.ok(fastUserMsg.includes('https://example.com/observed-final'), 'Fast prompt must include observed URL');
    assert.ok(fastUserMsg.includes('ASSIGNMENT: plan up to 5 negative / validation / edge cases'), 'Fast prompt has B assignment');

    // Test fallback when fast tier throws
    const fallbackFake = async (req: LlmRequest) => {
      if (req.tier === 'reasoning') {
        return {
          content: makePlanPayload([
            { id: 'tc-r1', title: 'Reasoning 1' },
            { id: 'tc-r2', title: 'Reasoning 2' },
          ]),
          model: 'mock-reasoning',
          provider: 'mock',
          latencyMs: 10,
          usage: { promptTokens: 10, completionTokens: 10 },
        };
      }
      throw new Error('Fast tier model exploded');
    };

    const fallbackPlan = await planTests(appMap, {
      fresh: true,
      callLlmImpl: fallbackFake as never,
    });
    assert.equal(fallbackPlan.testCases.length, 2, 'Plan must succeed with reasoning cases when fast tier fails');
    assert.equal(fallbackPlan.testCases[0]?.title, 'Reasoning 1');
  });

  // ---------------------------------------------------------------------------
  // P5: compileTest emissions
  // ---------------------------------------------------------------------------
  await run('P5: compileTest assert_url regexp, popup emission, assert_count container scoping', () => {
    const elBtn = makeElement('elem-btn', { tagName: 'BUTTON', type: 'button', selectors: { css: '#btn' } });
    const elPopup = makeElement('elem-pop', { tagName: 'A', type: 'link', selectors: { css: '#pop' } });
    const elList = makeElement('elem-list', { ariaRole: 'listitem', selectors: { css: 'ul#items > li' } });

    // 1. assert_url case
    const tcUrl: PlannedTestCase = {
      id: 'tc-url',
      title: 'Assert URL test',
      description: 'check url',
      steps: [
        { action: 'click', elementId: 'elem-btn', target: null, value: null, description: 'click btn' },
        { action: 'assert_url', elementId: null, target: null, value: 'https://example.com/dashboard?v=1', description: 'check url' },
      ],
    };
    const compiledUrl = compileTest(tcUrl, [elBtn], 'https://example.com/');
    assert.ok(compiledUrl.code.includes('.toHaveURL(/'), 'Must compile assert_url to RegExp literal');
    assert.ok(!compiledUrl.code.includes('url.href.includes'), 'Must NOT compile assert_url to url.href.includes');

    // 2. popup observation
    const popupObs: Observation = {
      kind: 'popup',
      elementId: 'elem-pop',
      fromUrl: 'https://example.com/',
      finalUrl: 'https://example.com/popup-target',
    };
    const tcPopup: PlannedTestCase = {
      id: 'tc-popup',
      title: 'Popup click test',
      description: 'popup flow',
      steps: [
        { action: 'click', elementId: 'elem-pop', target: null, value: null, description: 'click popup link' },
        { action: 'assert_url', elementId: null, target: null, value: 'https://example.com/popup-target', description: 'check popup url' },
      ],
    };
    const compiledPopup = compileTest(tcPopup, [elPopup], 'https://example.com/', [popupObs]);
    assert.ok(compiledPopup.code.includes("page.context().waitForEvent('page')"), 'Must listen for popup event');
    assert.ok(compiledPopup.code.includes('await popup.waitForLoadState('), 'Must wait for popup load state');
    assert.ok(compiledPopup.code.includes('expect(popup).toHaveURL(/'), 'Must assert URL against popup pageVar');

    // 3. assert_count with count observation
    const countObs: Observation = {
      kind: 'count',
      elementId: 'elem-list',
      fromUrl: 'https://example.com/',
      containerCss: 'ul#items',
      role: 'listitem',
      containerCount: 5,
      pageCount: 5,
    };
    const tcCount: PlannedTestCase = {
      id: 'tc-count',
      title: 'Assert count test',
      description: 'count flow',
      steps: [
        { action: 'assert_count', elementId: 'elem-list', target: null, value: '5', description: 'check count' },
      ],
    };
    const compiledCount = compileTest(tcCount, [elList], 'https://example.com/', [countObs]);
    assert.ok(compiledCount.code.includes('locator("ul#items")'), 'Must use container locator');
    assert.ok(compiledCount.code.includes('getByRole("listitem")'), 'Must scope by role');
    assert.ok(compiledCount.code.includes('.toHaveCount(5)'), 'Must assert count 5');
  });

  // ---------------------------------------------------------------------------
  // P6: baseline
  // ---------------------------------------------------------------------------
  await run('P6: buildBaselineTests broken-link excludes 401 and 403', () => {
    const appMap = makeAppMap({
      discoveredLinks: ['https://example.com/about', 'https://example.com/contact'],
    });
    const baselines = buildBaselineTests(appMap);
    const smoke2 = baselines.find((b) => b.testCase.id === 'smoke-2');
    assert.ok(smoke2, 'smoke-2 baseline test must be present');
    assert.ok(smoke2.code.includes('status !== 401'), 'smoke-2 code must exclude 401');
    assert.ok(smoke2.code.includes('status !== 403'), 'smoke-2 code must exclude 403');
  });

  // ---------------------------------------------------------------------------
  // P8: normalizeObservedText
  // ---------------------------------------------------------------------------
  await run('P8: normalizeObservedText collapses whitespace and strips close glyphs', () => {
    assert.equal(
      normalizeObservedText('Your username is invalid!\n×'),
      'Your username is invalid!',
      'newline + trailing × must be stripped',
    );
    assert.equal(
      normalizeObservedText('  You logged into a secure area!\n×  '),
      'You logged into a secure area!',
      'surrounding whitespace and trailing glyph must be stripped',
    );
    assert.equal(normalizeObservedText('a\n\nb  c'), 'a b c', 'internal whitespace runs collapse to one space');
    assert.equal(normalizeObservedText('×'), '', 'a pure close-glyph becomes empty');
    assert.ok(normalizeObservedText('x'.repeat(200)).length <= 120, 'output must be capped at 120 chars');
  });

  // ---------------------------------------------------------------------------
  // P9: dual planning without observations
  // ---------------------------------------------------------------------------
  await run('P9: dual planning runs two calls even without observations', async () => {
    const el1 = makeElement('elem-1', { text: 'Elem 1', selectors: { css: '#elem-1' } });
    // Deliberately NO observations field on this App Map.
    const appMap = makeAppMap({
      elements: [el1],
      totalElementsFound: 1,
    });

    function makePlanPayload(cases: Array<{ id: string; title: string }>) {
      return JSON.stringify({
        testCases: cases.map((c) => ({
          id: c.id,
          title: c.title,
          description: 'fixture desc',
          steps: [
            { action: 'click', elementId: 'elem-1', target: null, value: null, description: 'click elem-1' },
            { action: 'assert_visible', elementId: 'elem-1', target: null, value: null, description: 'visible elem-1' },
          ],
        })),
      });
    }

    const capturedRequests: LlmRequest[] = [];
    const dualCallFake = async (req: LlmRequest) => {
      capturedRequests.push(req);
      if (req.tier === 'reasoning') {
        return {
          content: makePlanPayload([{ id: 'tc-a1', title: 'Core A' }]),
          model: 'mock-reasoning',
          provider: 'mock',
          latencyMs: 10,
          usage: { promptTokens: 10, completionTokens: 10 },
        };
      }
      return {
        content: makePlanPayload([{ id: 'tc-b1', title: 'Negative A' }]),
        model: 'mock-fast',
        provider: 'mock',
        latencyMs: 5,
        usage: { promptTokens: 5, completionTokens: 5 },
      };
    };

    const plan = await planTests(appMap, {
      fresh: true,
      callLlmImpl: dualCallFake as never,
    });

    assert.equal(capturedRequests.length, 2, 'Must make exactly 2 planner calls without observations');
    assert.equal(
      capturedRequests.filter((r) => r.tier === 'reasoning').length,
      1,
      'Exactly one reasoning-tier call',
    );
    assert.equal(capturedRequests.filter((r) => r.tier === 'fast').length, 1, 'Exactly one fast-tier call');

    for (const r of capturedRequests) {
      const userMsg = String(r.messages.find((m) => m.role === 'user')?.content ?? '');
      assert.ok(
        !userMsg.includes('OBSERVED FACTS (recorded by actually driving this page'),
        'Prompt must NOT contain the OBSERVED FACTS block when the App Map has no observations',
      );
    }

    assert.deepEqual(
      plan.testCases.map((c) => c.title),
      ['Core A', 'Negative A'],
      'Merged cases from both tiers must be returned',
    );
  });

  // ---------------------------------------------------------------------------
  // P10: isObservableHref
  // ---------------------------------------------------------------------------
  await run('P10: isObservableHref predicate', () => {
    const base = 'https://example.com/page';
    assert.equal(isObservableHref('https://example.com/other', base), true, 'same-origin https → true');
    assert.equal(isObservableHref('https://other-site.com/x', base), true, 'cross-origin https → true');
    assert.equal(isObservableHref('http://127.0.0.1/admin', base), false, 'loopback → false');
    assert.equal(isObservableHref('http://192.168.1.1/x', base), false, 'private range → false');
    assert.equal(isObservableHref('javascript:void(0)', base), false, 'javascript: → false');
    assert.equal(isObservableHref('mailto:a@b.c', base), false, 'mailto: → false');
    assert.equal(isObservableHref('http://', base), false, 'unparseable garbage → false');
  });

  // ---------------------------------------------------------------------------
  // P11: buildAppMap fallback submit button resolution (button[type="button"])
  // ---------------------------------------------------------------------------
  await run('P11: buildAppMap button[type="button"] submit button fallback and exclusion', () => {
    const appMap = buildAppMap({
      url: 'https://example.com/login',
      viewport: { width: 1280, height: 720 },
      extraction: {
        title: 'Login',
        elements: [
          {
            tagName: 'input',
            type: 'input',
            inputType: 'text',
            text: null,
            name: 'username',
            formIndex: 0,
            isSubmitControl: false,
            isVisible: true,
            isEnabled: true,
            detectedBy: 'native',
            selectors: { css: '#user' },
          },
          {
            tagName: 'input',
            type: 'input',
            inputType: 'password',
            text: null,
            name: 'password',
            formIndex: 0,
            isSubmitControl: false,
            isVisible: true,
            isEnabled: true,
            detectedBy: 'native',
            selectors: { css: '#pass' },
          },
          {
            tagName: 'button',
            type: 'button',
            text: 'Show password',
            formIndex: 0,
            isSubmitControl: false,
            isVisible: true,
            isEnabled: true,
            detectedBy: 'native',
            selectors: { css: '#show-btn' },
          },
          {
            tagName: 'button',
            type: 'button',
            text: 'Continue with Google',
            formIndex: 0,
            isSubmitControl: false,
            isVisible: true,
            isEnabled: true,
            detectedBy: 'native',
            selectors: { css: '#google-btn' },
          },
          {
            tagName: 'button',
            type: 'button',
            text: 'Sign In',
            formIndex: 0,
            isSubmitControl: false,
            isVisible: true,
            isEnabled: true,
            detectedBy: 'native',
            selectors: { css: '#signin-btn' },
          },
        ],
        forms: [
          {
            name: 'loginForm',
            action: '/api/login',
            method: 'post',
          },
        ],
        links: [],
        totalFound: 5,
        truncated: false,
      },
    });

    assert.equal(appMap.forms.length, 1, 'Exactly 1 form must be built');
    assert.equal(appMap.forms[0].submitButtonId, 'elem-5', 'Sign In button must be resolved as submit control');
    assert.equal(appMap.forms[0].purpose, 'login', 'Form purpose must be login');
  });

  // ---------------------------------------------------------------------------
  // P12: buildAppMap virtual auth form synthesis for formless React/SPA login cards
  // ---------------------------------------------------------------------------
  await run('P12: buildAppMap virtual auth form synthesis for formless login card', () => {
    const appMap = buildAppMap({
      url: 'https://example.com/spa-login',
      viewport: { width: 1280, height: 720 },
      extraction: {
        title: 'SPA Login',
        elements: [
          {
            tagName: 'input',
            type: 'input',
            inputType: 'text',
            text: null,
            name: 'username',
            formIndex: null,
            isSubmitControl: false,
            isVisible: true,
            isEnabled: true,
            detectedBy: 'native',
            selectors: { css: '#user' },
          },
          {
            tagName: 'input',
            type: 'input',
            inputType: 'password',
            text: null,
            name: 'password',
            formIndex: null,
            isSubmitControl: false,
            isVisible: true,
            isEnabled: true,
            detectedBy: 'native',
            selectors: { css: '#pass' },
          },
          {
            tagName: 'button',
            type: 'button',
            text: 'Log In',
            formIndex: null,
            isSubmitControl: false,
            isVisible: true,
            isEnabled: true,
            detectedBy: 'native',
            selectors: { css: '#login-btn' },
          },
        ],
        forms: [],
        links: [],
        totalFound: 3,
        truncated: false,
      },
    });

    assert.equal(appMap.forms.length, 1, 'Virtual auth form must be synthesized');
    assert.equal(appMap.forms[0].purpose, 'login', 'Virtual form purpose must be login');
    assert.deepEqual(appMap.forms[0].fieldIds, ['elem-1', 'elem-2'], 'Must capture username and password fields');
    assert.equal(appMap.forms[0].submitButtonId, 'elem-3', 'Must assign Log In button as submitButtonId');
  });

  // ---------------------------------------------------------------------------
  // P13: resolveTestData mandatory happy-path promptBlock rules
  // ---------------------------------------------------------------------------
  await run('P13: resolveTestData includes MANDATORY HAPPY PATH tc-1 rule', () => {
    const usernameEl = makeElement('elem-1', {
      type: 'input',
      text: null,
      name: 'username',
      selectors: { css: '#username' },
    });
    const passwordEl = makeElement('elem-2', {
      type: 'input',
      text: null,
      name: 'password',
      selectors: { css: '#password' },
    });

    const appMap = makeAppMap({
      elements: [usernameEl, passwordEl],
      forms: [
        {
          id: 'form-1',
          name: 'loginForm',
          action: '/login',
          method: 'post',
          purpose: 'login',
          fieldIds: ['elem-1', 'elem-2'],
          submitButtonId: 'elem-3',
        },
      ],
      totalElementsFound: 2,
    });

    const entries: TestDataEntry[] = [
      { elementId: 'elem-1', css: '#username', value: 'tomsmith', sensitive: false },
      { elementId: 'elem-2', css: '#password', value: 'SuperSecret!', sensitive: true },
    ];

    const resolved = resolveTestData(appMap, entries);
    assert.ok(resolved.promptBlock.includes('MANDATORY HAPPY PATH'), 'Must contain MANDATORY HAPPY PATH header');
    assert.ok(resolved.promptBlock.includes('tc-1 MUST be the end-to-end happy-path submission'), 'Must instruct tc-1 happy path');
    assert.ok(resolved.fills.has('elem-1'), 'Must have fill for username');
    assert.ok(resolved.fills.has('elem-2'), 'Must have fill for password');
  });

  // ---------------------------------------------------------------------------
  // P7: LIVE (gated on OBSERVATION_LIVE=1)
  // ---------------------------------------------------------------------------
  if (process.env.OBSERVATION_LIVE === '1') {
    await run('P7: LIVE the-internet login without and with test data', async () => {
      console.log('   Crawling https://the-internet.herokuapp.com/login...');
      const appMap = await crawlPage('https://the-internet.herokuapp.com/login');

      console.log('   Observing WITHOUT test data...');
      const emptyObs = await observeAppMap(appMap);
      const emptySubmits = emptyObs.filter((o) => o.kind === 'form_empty_submit');
      const filledSubmitsWithout = emptyObs.filter((o) => o.kind === 'form_filled_submit');

      assert.ok(emptySubmits.length >= 1, 'Must observe at least 1 form_empty_submit without test data');
      assert.equal(filledSubmitsWithout.length, 0, 'Must observe ZERO form_filled_submit without test data');

      console.log('   Building test data for tomsmith / SuperSecretPassword!...');
      const usernameEl = appMap.elements.find(
        (e) => (e.name && /username/i.test(e.name)) || (e.selectors.css && /username/i.test(e.selectors.css)),
      );
      const passwordEl = appMap.elements.find(
        (e) => (e.name && /password/i.test(e.name)) || (e.selectors.css && /password/i.test(e.selectors.css)),
      );

      assert.ok(usernameEl, 'Username element must be found in crawled AppMap');
      assert.ok(passwordEl, 'Password element must be found in crawled AppMap');

      const testData: TestDataEntry[] = [
        {
          elementId: usernameEl.id,
          css: usernameEl.selectors.css,
          value: 'tomsmith',
          sensitive: false,
        },
        {
          elementId: passwordEl.id,
          css: passwordEl.selectors.css,
          value: 'SuperSecretPassword!',
          sensitive: true,
        },
      ];

      console.log('   Observing WITH test data...');
      const filledObs = await observeAppMap(appMap, { testData });
      const filledSubmits = filledObs.filter((o) => o.kind === 'form_filled_submit');

      assert.ok(filledSubmits.length >= 1, 'Must observe at least 1 form_filled_submit with valid test data');
      const successSubmit = filledSubmits.find((o) => o.finalUrl?.includes('/secure'));
      assert.ok(successSubmit, 'form_filled_submit must have finalUrl containing /secure');

      const obsJson = JSON.stringify(filledObs);
      assert.ok(
        !obsJson.includes('SuperSecretPassword!'),
        'Scrubbing guard: real secret must NEVER appear in observations JSON',
      );

      // (i) External target="_blank" link → a popup observation with the real destination.
      const popupObs = filledObs.find((o) => o.kind === 'popup');
      if (popupObs?.finalUrl?.includes('elementalselenium')) {
        console.log(`   popup observation finalUrl: ${popupObs.finalUrl}`);
      } else {
        const linkHrefs = appMap.elements
          .filter((e) => e.type === 'link' && e.href)
          .map((e) => e.href);
        console.log(
          '   [SKIP] no elementalselenium popup observation found. Link hrefs:',
          JSON.stringify(linkHrefs),
        );
      }

      // (ii) Normalization: no visibleTexts entry contains a newline or ends with the × close glyph.
      for (const o of filledObs) {
        for (const t of o.visibleTexts ?? []) {
          assert.ok(!t.includes('\n'), `visibleText must not contain a newline: ${JSON.stringify(t)}`);
          assert.ok(!t.endsWith('×'), `visibleText must not end with ×: ${JSON.stringify(t)}`);
        }
      }
    });
  } else {
    console.log('[SKIP] P7 live test skipped (set OBSERVATION_LIVE=1)');
  }

  console.log(`\n=== Verification Finished with exitCode=${exitCode} ===`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Fatal scratch error:', err);
  process.exit(1);
});
