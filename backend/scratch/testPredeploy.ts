// Mock minimal environment for tests
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
process.env.DIRECT_URL = 'postgresql://user:pass@localhost:5432/db';

import assert from 'node:assert/strict';
import {
  serializeObservations,
  enforceTestData,
  enforceUnprovidedPasswordGuard,
  validateAndNormalizePlan,
} from '../src/agent/steps/planner.ts';
import type { Observation } from '../src/crawler/types.ts';
import type { TestPlan } from '../src/agent/prompts/plannerPrompt.ts';

let failures = 0;

function pass(name: string): void {
  console.log(`PASS ${name}`);
}

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    failures++;
    console.error(`FAIL ${name}:`, err);
  }
}

async function main(): Promise<void> {
  // ──────────────────────────────────────────────────
  // P1: serializeObservations always returns valid JSON
  // ──────────────────────────────────────────────────
  await run('P1 serializeObservations returns valid JSON', async () => {
    const obs: Observation[] = [
      {
        kind: 'navigation',
        fromUrl: 'https://example.com',
        visibleTexts: ['Hello world', 'a'.repeat(200)],
      },
      {
        kind: 'popup',
        fromUrl: 'https://example.com/page2',
        visibleTexts: ['Popup text'],
      },
    ];

    const result = serializeObservations(obs);
    assert.ok(result !== undefined, 'should return a string');

    // Must be valid JSON — the old .slice fallback could break this
    let parsed: unknown;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(result!);
    }, 'output must be valid JSON');

    assert.ok(Array.isArray(parsed), 'parsed result should be an array');
    pass('P1 serializeObservations returns valid JSON');
  });

  // ──────────────────────────────────────────────────
  // P2: serializeObservations respects maxChars
  // ──────────────────────────────────────────────────
  await run('P2 serializeObservations respects maxChars budget', async () => {
    // Create observations large enough to exceed a small budget
    const bigObs: Observation[] = [];
    for (let i = 0; i < 20; i++) {
      bigObs.push({
        kind: 'count',
        fromUrl: `https://example.com/page${i}`,
        visibleTexts: Array.from({ length: 10 }, (_, j) => `text-${i}-${j}-${'x'.repeat(80)}`),
      });
    }

    const maxChars = 500;
    const result = serializeObservations(bigObs, maxChars);
    assert.ok(result !== undefined, 'should return a string for non-empty input');
    assert.ok(result!.length <= maxChars + 200, `result length ${result!.length} should be near or under maxChars=${maxChars}`);

    // Must still be valid JSON
    assert.doesNotThrow(() => JSON.parse(result!), 'trimmed output must still be valid JSON');
    pass('P2 serializeObservations respects maxChars budget');
  });

  // ──────────────────────────────────────────────────
  // P3: enforceTestData with 0 surviving cases should
  //     produce an empty testCases array (caller guards)
  // ──────────────────────────────────────────────────
  await run('P3 enforceTestData filters out cases without assertions', async () => {
    const plan: TestPlan = {
      testCases: [
        {
          id: 'tc-1',
          title: 'Test with only fill steps and secret assertions',
          steps: [
            { action: 'fill', elementId: 'field-1', value: 'hello' },
            { action: 'assert_text', elementId: 'result', value: '__AGT_SECRET_1__' },
          ],
        },
      ],
    };

    const fills = new Map([['field-1', 'world']]);
    const result = enforceTestData(plan, fills);

    // The only test case has its assert_text step removed (secret pattern),
    // and then no assert_ steps remain, so the case should be dropped
    assert.equal(result.testCases.length, 0, 'plan should have 0 cases after filtering');
    pass('P3 enforceTestData filters out cases without assertions');
  });

  // ──────────────────────────────────────────────────
  // P4: negative case with '' fill keeps '' after enforce
  // ──────────────────────────────────────────────────
  await run('P4 negative case with empty fill keeps empty string', async () => {
    const plan: TestPlan = {
      testCases: [
        {
          id: 'tc-1',
          title: 'Empty email submission',
          description: 'Submitting the form with empty email should show validation error',
          intent: 'negative',
          steps: [
            { action: 'fill', elementId: 'email-input', value: '' },
            { action: 'click', elementId: 'submit-btn', value: null },
            { action: 'assert_visible', elementId: 'error-msg', value: null },
          ],
        },
      ],
    };

    const fills = new Map([['email-input', 'alice@example.com']]);
    const result = enforceTestData(plan, fills);

    assert.equal(result.testCases.length, 1);
    const fillStep = result.testCases[0].steps.find((s) => s.action === 'fill');
    assert.ok(fillStep, 'fill step must exist');
    assert.equal(fillStep.value, '', 'negative case with explicit empty fill must keep empty string');
    pass('P4 negative case with empty fill keeps empty string');
  });

  // ──────────────────────────────────────────────────
  // P5: negative case with literal wrong-password keeps it
  //     while valid username token fill is retained
  // ──────────────────────────────────────────────────
  await run('P5 negative case keeps invalid literal while retaining valid tokens', async () => {
    const plan: TestPlan = {
      testCases: [
        {
          id: 'tc-1',
          title: 'Invalid password login attempt',
          description: 'Logging in with valid user and wrong password',
          intent: 'negative',
          steps: [
            { action: 'fill', elementId: 'user-input', value: '__AGT_SECRET_1__' },
            { action: 'fill', elementId: 'pass-input', value: 'wrong-password' },
            { action: 'click', elementId: 'login-btn', value: null },
            { action: 'assert_visible', elementId: 'login-error', value: null },
          ],
        },
      ],
    };

    const fills = new Map([
      ['user-input', '__AGT_SECRET_1__'],
      ['pass-input', '__AGT_SECRET_2__'],
    ]);
    const result = enforceTestData(plan, fills);

    assert.equal(result.testCases.length, 1);
    const userStep = result.testCases[0].steps.find((s) => s.elementId === 'user-input');
    const passStep = result.testCases[0].steps.find((s) => s.elementId === 'pass-input');

    assert.ok(userStep && passStep, 'both fill steps must exist');
    assert.equal(userStep.value, '__AGT_SECRET_1__', 'exact token fill should be retained');
    assert.equal(passStep.value, 'wrong-password', 'planner-chosen invalid literal must not be overwritten');
    pass('P5 negative case keeps invalid literal while retaining valid tokens');
  });

  // ──────────────────────────────────────────────────
  // P6: positive case still gets test-data substitution
  // ──────────────────────────────────────────────────
  await run('P6 positive case still gets test-data substitution', async () => {
    const plan: TestPlan = {
      testCases: [
        {
          id: 'tc-1',
          title: 'Happy path login',
          description: 'Logging in successfully with valid credentials',
          intent: 'positive',
          steps: [
            { action: 'fill', elementId: 'user-input', value: 'old-placeholder' },
            { action: 'click', elementId: 'login-btn', value: null },
            { action: 'assert_visible', elementId: 'dashboard', value: null },
          ],
        },
      ],
    };

    const fills = new Map([['user-input', 'real-user']]);
    const result = enforceTestData(plan, fills);

    assert.equal(result.testCases.length, 1);
    const userStep = result.testCases[0].steps.find((s) => s.elementId === 'user-input');
    assert.ok(userStep, 'fill step must exist');
    assert.equal(userStep.value, 'real-user', 'positive case must have test-data substituted');
    pass('P6 positive case still gets test-data substitution');
  });

  // ──────────────────────────────────────────────────
  // P7: Case filling unprovided password with literal dropped;
  //     sibling survives and renumbers to tc-1
  // ──────────────────────────────────────────────────
  await run('P7 Case filling unprovided password with literal dropped; sibling survives and renumbers', async () => {
    const unprovided = new Set(['pwd-field']);
    const plan: TestPlan = {
      testCases: [
        {
          id: 'tc-1',
          title: 'Invented password fill',
          description: 'Should be dropped',
          steps: [
            { action: 'fill', elementId: 'pwd-field', value: 'secret123' },
            { action: 'click', elementId: 'submit-btn', value: null },
            { action: 'assert_visible', elementId: 'dashboard', value: null },
          ],
        },
        {
          id: 'tc-2',
          title: 'Navigation test sibling',
          description: 'Should survive and renumber to tc-1',
          steps: [
            { action: 'click', elementId: 'nav-link', value: null },
            { action: 'assert_url', elementId: null, value: 'https://example.com/about' },
          ],
        },
      ],
    };

    const result = enforceUnprovidedPasswordGuard(plan, unprovided);
    assert.equal(result.testCases.length, 1, 'case filling unprovided password must be dropped');
    assert.equal(result.testCases[0].title, 'Navigation test sibling');
    assert.equal(result.testCases[0].id, 'tc-1', 'surviving sibling must renumber to tc-1');
    pass('P7 Case filling unprovided password with literal dropped; sibling survives and renumbers');
  });

  // ──────────────────────────────────────────────────
  // P8: Case with `fill ''` on unprovided password kept
  // ──────────────────────────────────────────────────
  await run('P8 Case with fill empty string on unprovided password kept', async () => {
    const unprovided = new Set(['pwd-field']);
    const plan: TestPlan = {
      testCases: [
        {
          id: 'tc-1',
          title: 'Empty password validation',
          description: 'Submitting empty password',
          steps: [
            { action: 'fill', elementId: 'pwd-field', value: '' },
            { action: 'click', elementId: 'submit-btn', value: null },
            { action: 'assert_visible', elementId: 'error-msg', value: null },
          ],
        },
      ],
    };

    const result = enforceUnprovidedPasswordGuard(plan, unprovided);
    assert.equal(result.testCases.length, 1, 'case with empty string fill must be kept');
    assert.equal(result.testCases[0].steps[0].value, '');
    pass('P8 Case with fill empty string on unprovided password kept');
  });

  // ──────────────────────────────────────────────────
  // P9: Case omitting fill (assert/submit/assert_url) on unprovided password kept
  // ──────────────────────────────────────────────────
  await run('P9 Case omitting fill on unprovided password kept', async () => {
    const unprovided = new Set(['pwd-field']);
    const plan: TestPlan = {
      testCases: [
        {
          id: 'tc-1',
          title: 'Omitted password submission',
          description: 'Submitting without filling password field',
          steps: [
            { action: 'fill', elementId: 'user-field', value: 'alice' },
            { action: 'click', elementId: 'submit-btn', value: null },
            { action: 'assert_visible', elementId: 'pwd-required-msg', value: null },
            { action: 'assert_url', elementId: null, value: 'https://example.com/login' },
          ],
        },
      ],
    };

    const result = enforceUnprovidedPasswordGuard(plan, unprovided);
    assert.equal(result.testCases.length, 1, 'case omitting password fill must be kept');
    pass('P9 Case omitting fill on unprovided password kept');
  });

  // ──────────────────────────────────────────────────
  // P10: Provided password unaffected (negative wrong-literal and positive secret placeholder survive)
  // ──────────────────────────────────────────────────
  await run('P10 Provided password unaffected (wrong-literal and secret placeholder survive)', async () => {
    // When password field IS provided, it is NOT in unprovidedPasswordIds set
    const unprovided = new Set<string>(); // provided password is not in this set
    const plan: TestPlan = {
      testCases: [
        {
          id: 'tc-1',
          title: 'Positive login with secret placeholder',
          steps: [
            { action: 'fill', elementId: 'pwd-field', value: '__AGT_SECRET_1__' },
            { action: 'click', elementId: 'submit-btn', value: null },
            { action: 'assert_visible', elementId: 'dashboard', value: null },
          ],
        },
        {
          id: 'tc-2',
          title: 'Negative login with wrong-password literal',
          steps: [
            { action: 'fill', elementId: 'pwd-field', value: 'wrong-password' },
            { action: 'click', elementId: 'submit-btn', value: null },
            { action: 'assert_visible', elementId: 'error-banner', value: null },
          ],
        },
      ],
    };

    const result = enforceUnprovidedPasswordGuard(plan, unprovided);
    assert.equal(result.testCases.length, 2, 'both provided password cases must survive unaffected');
    assert.equal(result.testCases[0].steps[0].value, '__AGT_SECRET_1__');
    assert.equal(result.testCases[1].steps[0].value, 'wrong-password');
    pass('P10 Provided password unaffected (wrong-literal and secret placeholder survive)');
  });

  // ──────────────────────────────────────────────────
  // P11: Plan where every case fills unprovided password returns 0 cases
  //      (triggers zero-plan guard in finalizePlan)
  // ──────────────────────────────────────────────────
  await run('P11 Plan where every case fills unprovided password returns 0 cases', async () => {
    const unprovided = new Set(['pwd-field']);
    const plan: TestPlan = {
      testCases: [
        {
          id: 'tc-1',
          title: 'Invented password 1',
          steps: [
            { action: 'fill', elementId: 'pwd-field', value: 'admin123' },
            { action: 'assert_visible', elementId: 'dashboard', value: null },
          ],
        },
        {
          id: 'tc-2',
          title: 'Invented password 2',
          steps: [
            { action: 'fill', elementId: 'pwd-field', value: 'wrong-pass' },
            { action: 'assert_visible', elementId: 'error-msg', value: null },
          ],
        },
      ],
    };

    const result = enforceUnprovidedPasswordGuard(plan, unprovided);
    assert.equal(result.testCases.length, 0, 'all cases must be dropped when all fill unprovided passwords');
    pass('P11 Plan where every case fills unprovided password returns 0 cases');
  });

  // ──────────────────────────────────────────────────
  // P12: Locator-less assert_text with a value normalizes to assert_visible
  // ──────────────────────────────────────────────────
  await run('P12 Locator-less assert_text with value normalizes to assert_visible', async () => {
    const raw = JSON.stringify({
      testCases: [
        {
          id: 'tc-1',
          title: 'Flash banner check',
          description: 'Check flash banner visibility',
          steps: [
            {
              action: 'assert_text',
              elementId: null,
              value: 'Your username is invalid!',
              description: 'Verify flash banner message',
            },
          ],
        },
      ],
    });
    const result = validateAndNormalizePlan(raw, new Set(), 'https://example.com/login');
    assert.equal(result.ok, true, 'normalization should allow schema parse to succeed');
    if (result.ok) {
      assert.equal(result.plan.testCases[0].steps[0].action, 'assert_visible');
      assert.equal(result.plan.testCases[0].steps[0].value, 'Your username is invalid!');
      assert.equal(result.plan.testCases[0].steps[0].description, 'Verify flash banner message');
      assert.equal(result.plan.testCases[0].steps[0].elementId, null);
    }
    pass('P12 Locator-less assert_text with value normalizes to assert_visible');
  });

  // ──────────────────────────────────────────────────
  // P13: assert_text WITH a known elementId -> unchanged assert_text, ok:true
  // ──────────────────────────────────────────────────
  await run('P13 assert_text with known elementId remains unchanged', async () => {
    const raw = JSON.stringify({
      testCases: [
        {
          id: 'tc-1',
          title: 'Heading text check',
          description: 'Check heading text',
          steps: [
            {
              action: 'assert_text',
              elementId: 'heading-id',
              value: 'Welcome Back',
              description: 'Verify heading text',
            },
          ],
        },
      ],
    });
    const result = validateAndNormalizePlan(raw, new Set(['heading-id']), 'https://example.com/login');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.plan.testCases[0].steps[0].action, 'assert_text');
      assert.equal(result.plan.testCases[0].steps[0].elementId, 'heading-id');
      assert.equal(result.plan.testCases[0].steps[0].value, 'Welcome Back');
    }
    pass('P13 assert_text with known elementId remains unchanged');
  });

  // ──────────────────────────────────────────────────
  // P14: assert_text WITH a valid target -> unchanged
  // ──────────────────────────────────────────────────
  await run('P14 assert_text with valid target remains unchanged', async () => {
    const raw = JSON.stringify({
      testCases: [
        {
          id: 'tc-1',
          title: 'Target text check',
          description: 'Check target text',
          steps: [
            {
              action: 'assert_text',
              elementId: null,
              target: { role: 'heading', name: 'Dashboard' },
              value: 'Dashboard',
              description: 'Verify heading target text',
            },
          ],
        },
      ],
    });
    const result = validateAndNormalizePlan(raw, new Set(), 'https://example.com/dashboard');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.plan.testCases[0].steps[0].action, 'assert_text');
      assert.deepEqual(result.plan.testCases[0].steps[0].target, { role: 'heading', name: 'Dashboard' });
      assert.equal(result.plan.testCases[0].steps[0].value, 'Dashboard');
    }
    pass('P14 assert_text with valid target remains unchanged');
  });

  // ──────────────────────────────────────────────────
  // P15: Locator-less assert_text with empty string or null value -> ok:false, kind 'schema'
  // ──────────────────────────────────────────────────
  await run('P15 Locator-less assert_text with empty string or null value is not converted and fails schema', async () => {
    const rawEmpty = JSON.stringify({
      testCases: [
        {
          id: 'tc-1',
          title: 'Empty text check',
          description: 'Check empty text',
          steps: [
            {
              action: 'assert_text',
              elementId: null,
              value: '',
              description: 'Empty value assert_text',
            },
          ],
        },
      ],
    });
    const resultEmpty = validateAndNormalizePlan(rawEmpty, new Set(), 'https://example.com');
    assert.equal(resultEmpty.ok, false);
    if (!resultEmpty.ok) {
      assert.equal(resultEmpty.kind, 'schema');
    }

    const rawNull = JSON.stringify({
      testCases: [
        {
          id: 'tc-1',
          title: 'Null text check',
          description: 'Check null text',
          steps: [
            {
              action: 'assert_text',
              elementId: null,
              value: null,
              description: 'Null value assert_text',
            },
          ],
        },
      ],
    });
    const resultNull = validateAndNormalizePlan(rawNull, new Set(), 'https://example.com');
    assert.equal(resultNull.ok, false);
    if (!resultNull.ok) {
      assert.equal(resultNull.kind, 'schema');
    }
    pass('P15 Locator-less assert_text with empty string or null value is not converted and fails schema');
  });

  // ──────────────────────────────────────────────────
  // P16: assert_text with hallucinated elementId -> NOT converted, returns references error
  // ──────────────────────────────────────────────────
  await run('P16 assert_text with hallucinated elementId is not converted and returns references error', async () => {
    const raw = JSON.stringify({
      testCases: [
        {
          id: 'tc-1',
          title: 'Hallucinated id check',
          description: 'Check hallucinated id',
          steps: [
            {
              action: 'assert_text',
              elementId: 'ghost-elem',
              value: 'Some text',
              description: 'Verify text on non-existent element',
            },
          ],
        },
      ],
    });
    const result = validateAndNormalizePlan(raw, new Set(['known-elem']), 'https://example.com');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, 'references');
      assert.ok(result.badCaseIndexes.has(0));
      assert.equal(result.plan.testCases[0].steps[0].action, 'assert_text');
    }
    pass('P16 assert_text with hallucinated elementId is not converted and returns references error');
  });

  // ──────────────────────────────────────────────────
  // P17: Mixed plan: converted step survives while hallucinated case triggers references kind
  // ──────────────────────────────────────────────────
  await run('P17 Mixed plan: converted step survives while hallucinated case triggers references kind', async () => {
    const raw = JSON.stringify({
      testCases: [
        {
          id: 'tc-1',
          title: 'Case 1: Locator-less banner',
          description: 'Check banner',
          steps: [
            {
              action: 'assert_text',
              elementId: null,
              value: 'Logged out successfully',
              description: 'Flash toast',
            },
          ],
        },
        {
          id: 'tc-2',
          title: 'Case 2: Hallucinated reference',
          description: 'Check ghost button',
          steps: [
            {
              action: 'click',
              elementId: 'ghost-button',
              value: null,
              description: 'Click ghost button',
            },
          ],
        },
      ],
    });
    const result = validateAndNormalizePlan(raw, new Set(['known-button']), 'https://example.com');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, 'references');
      assert.ok(result.badCaseIndexes.has(1), 'case 2 must be in badCaseIndexes');
      assert.ok(!result.badCaseIndexes.has(0), 'case 1 must not be in badCaseIndexes');
      assert.equal(result.plan.testCases[0].steps[0].action, 'assert_visible', 'case 1 step must be normalized to assert_visible');
      assert.equal(result.plan.testCases[0].steps[0].elementId, null);
    }
    pass('P17 Mixed plan: converted step survives while hallucinated case triggers references kind');
  });

  // ──────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────
  console.log(`\n--- testPredeploy summary: ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`} ---`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
