import assert from 'node:assert/strict';
import { summarizeFailure } from '../src/report/failureSummary.ts';
import { filterInternalLinks } from '../src/crawler/appMapBuilder.ts';
import { isBotWall } from '../src/crawler/pageCrawler.ts';
import { planTests } from '../src/agent/steps/planner.ts';
import { buildBaselineTests } from '../src/agent/baseline.ts';
import { findUnsafeConstructs } from '../src/runner/codeSafety.ts';
import type { AppMap } from '../src/crawler/types.ts';

async function main() {
  console.log('=== Running Batch QF2 Verification Tests ===\n');

  // 1. summarizeFailure toHaveURL fixture (EXACT spec text)
  console.log('1. summarizeFailure toHaveURL fixture...');
  const fx1 = `Error: expect(page).toHaveURL(expected) failed

Expected pattern: /github\\.com/
Received string:  "http://localhost:3000/limitations"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    9 × unexpected value "http://localhost:3000/limitations"

   5 |   await expect(page.getByRole('link', { name: 'GitHub' })).toBeVisible();
   6 |   await page.getByRole('link', { name: 'GitHub' }).click();
>  7 |   await expect(page).toHaveURL(/github\\.com/);
     |                      ^
   8 |   await expect(page.getByRole('heading', { name: 'Limitations' })).toBeVisible();
   9 | });`;

  const s1 = summarizeFailure(fx1);
  assert.ok(s1.headline.includes('page address'), 'headline must include "page address"');
  assert.ok(!/hidden/i.test(s1.headline), 'headline must NOT include "hidden"');
  assert.equal(s1.line, 7, 'line must be 7');
  assert.ok(s1.codeFrame?.includes('>  7 |'), 'codeFrame must include ">  7 |"');
  assert.ok(/^\s*\|\s*\^/m.test(s1.codeFrame ?? ''), 'codeFrame must include caret line matching /^\\s*\\|\\s*\\^/m');
  assert.ok(s1.received?.includes('localhost:3000/limitations'), 'received must include localhost:3000/limitations');
  console.log('   ✓ Group 1: toHaveURL spec-verbatim fixture passed');

  // 2. summarizeFailure toHaveCount fixture (EXACT spec text)
  console.log('2. summarizeFailure toHaveCount fixture...');
  const fx2 = `Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('listitem')
Expected: 1
Received: 4
Timeout:  5000ms

   4 |   await expect(page.getByRole('textbox')).toBeVisible();
>  5 |   await expect(page.getByRole('listitem')).toHaveCount(1);
     |                                            ^`;

  const s2 = summarizeFailure(fx2);
  assert.ok(s2.headline.includes('1'), 'headline must include "1"');
  assert.ok(s2.headline.includes('4'), 'headline must include "4"');
  assert.ok(!/hidden/i.test(s2.headline), 'headline must NOT include "hidden"');
  assert.equal(s2.line, 5, 'line must be 5');
  console.log('   ✓ Group 2: toHaveCount spec-verbatim fixture passed');

  // 3. Old-format visibility (EXACT spec string)
  console.log('3. Old-format visibility (element_missing)...');
  const fx3 = "Error: Timed out 5000ms waiting for expect(locator).toBeVisible()\n\nLocator: getByText('Saved')\nExpected: visible\nReceived: <element(s) not found>";
  const s3 = summarizeFailure(fx3);
  assert.equal(s3.kind, 'element_missing', 'kind must be element_missing');
  console.log('   ✓ Group 3: old-format toBeVisible produces element_missing');

  // 4. .not.toBeVisible (assertion, NOT element_missing)
  console.log('4. .not.toBeVisible fixture...');
  const notVisErr = `Error: Timed out 5000ms waiting for expect(locator).not.toBeVisible()

Locator: getByRole('button', { name: 'Delete' })
Call log:
  - locator resolved to visible <button>Delete</button>

   > 15 |   await expect(page.getByRole('button', { name: 'Delete' })).not.toBeVisible();
        |                                                                  ^`;
  const notVisSum = summarizeFailure(notVisErr);
  assert.equal(notVisSum.kind, 'assertion');
  assert.ok(notVisSum.headline.includes('Expected the "Delete" button to be hidden; it was visible.'));
  console.log('   ✓ Group 4: .not.toBeVisible classified as assertion');

  // 5. filterInternalLinks Amazon-like fixture per spec (>=40 entries)
  console.log('5. filterInternalLinks Amazon-like fixture per spec...');
  const amazonEntries: Array<{ href: string; text: string; inNav: boolean }> = [];

  // 20x search links (first 2 inNav: true, text "Today's Deals" on at least one)
  for (let n = 0; n < 20; n++) {
    const inNav = n < 2;
    const text = n === 0 ? "Today's Deals" : `Item Search ${n}`;
    amazonEntries.push({
      href: `https://www.amazon.in/s/?k=item${n}&ref=nav_${n}`,
      text,
      inNav,
    });
  }

  // 6x help links (text "Customer Service", inNav: true)
  for (let n = 0; n < 6; n++) {
    amazonEntries.push({
      href: `https://www.amazon.in/gp/help/customer/display.html?nodeId=${n}`,
      text: 'Customer Service',
      inNav: true,
    });
  }

  // 5x account edit links
  for (let n = 0; n < 5; n++) {
    amazonEntries.push({
      href: `https://www.amazon.in/gp/your-account/edit/ref=${n}`,
      text: 'Account Edit',
      inNav: false,
    });
  }

  // 2x signin links (one inNav: true)
  for (let n = 0; n < 2; n++) {
    amazonEntries.push({
      href: `https://www.amazon.in/ap/signin?x=${n}`,
      text: 'Sign In',
      inNav: n === 0,
    });
  }

  // 4x browse links
  for (let n = 0; n < 4; n++) {
    amazonEntries.push({
      href: `https://www.amazon.in/gp/browse.html?node=${n}&ref_=nav_${n}`,
      text: 'Browse',
      inNav: false,
    });
  }

  // Home variants
  amazonEntries.push({ href: 'https://www.amazon.in/ref=nav_logo', text: 'Amazon Logo', inNav: false });
  amazonEntries.push({ href: 'https://www.amazon.in/', text: 'Home', inNav: false });
  amazonEntries.push({ href: 'https://www.amazon.in/#top', text: 'Top', inNav: false });

  // 3x dp product links (n = 0, 1, 2)
  for (let n = 0; n < 3; n++) {
    amazonEntries.push({
      href: `https://www.amazon.in/dp/B0ABC1234${n}/`,
      text: `Product ${n}`,
      inNav: false,
    });
  }

  // Assets, foreign domain, mailto
  amazonEntries.push({ href: 'mailto:x@y.z', text: 'Mail', inNav: false });
  amazonEntries.push({ href: 'https://other.com/x', text: 'External', inNav: false });
  amazonEntries.push({ href: 'https://www.amazon.in/logo.png', text: 'Logo PNG', inNav: false });

  assert.ok(amazonEntries.length >= 40, `Fixture must contain >= 40 entries, has ${amazonEntries.length}`);

  const amzRes = filterInternalLinks(amazonEntries, 'https://www.amazon.in/');

  // Check kept link pathnames
  const sLinks = amzRes.links.filter(l => new URL(l).pathname.replace(/\/$/, '') === '/s');
  assert.equal(sLinks.length, 1, 'exactly one kept link with new URL(l).pathname === /s');

  const displayLinks = amzRes.links.filter(l => l.includes('display.html'));
  assert.equal(displayLinks.length, 1, 'exactly one containing display.html');

  const accountLinks = amzRes.links.filter(l => l.includes('/gp/your-account/edit'));
  assert.equal(accountLinks.length, 1, 'one containing /gp/your-account/edit');

  const signinLinks = amzRes.links.filter(l => l.includes('/ap/signin'));
  assert.equal(signinLinks.length, 1, 'one containing /ap/signin');

  const browseLinks = amzRes.links.filter(l => l.includes('browse.html'));
  assert.equal(browseLinks.length, 1, 'one containing browse.html');

  const dpLinks = amzRes.links.filter(l => l.includes('/dp/'));
  assert.equal(dpLinks.length, 1, 'one containing /dp/');

  // no kept link is home page or contains ref=nav_logo
  assert.ok(!amzRes.links.some(l => l === 'https://www.amazon.in/' || l === 'https://www.amazon.in' || l.includes('ref=nav_logo')), 'no kept link is home page or contains ref=nav_logo');

  // no assets, no other.com, no mailto
  assert.ok(!amzRes.links.some(l => l.endsWith('.png') || l.includes('other.com') || l.startsWith('mailto:')), 'no assets (.png), no other.com, no mailto:');

  // every label in labels is non-empty; none equals "S" or "B"; none starts with "Ref="
  for (const l of amzRes.links) {
    const label = amzRes.labels[l];
    assert.ok(label && label.length > 0, `label for ${l} must be non-empty`);
    assert.ok(label !== 'S' && label !== 'B', `label for ${l} must not equal S or B, got "${label}"`);
    assert.ok(!label.toLowerCase().startsWith('ref='), `label for ${l} must not start with Ref=, got "${label}"`);
  }

  // nav-first: every kept href whose source entry was inNav: true appears at a lower index than every kept href whose source entries were all inNav: false
  const inNavKept = amzRes.links.filter(l => l.includes('/s') || l.includes('display.html') || l.includes('/ap/signin'));
  const nonNavKept = amzRes.links.filter(l => l.includes('/gp/your-account/edit') || l.includes('browse.html') || l.includes('/dp/'));
  const maxInNavIndex = Math.max(...inNavKept.map(l => amzRes.links.indexOf(l)));
  const minNonNavIndex = Math.min(...nonNavKept.map(l => amzRes.links.indexOf(l)));
  assert.ok(maxInNavIndex < minNonNavIndex, `all inNav links (${maxInNavIndex}) appear before nonNav links (${minNonNavIndex})`);

  // kept hrefs contain no ref=, ref_=, or utm_ substrings
  assert.ok(!amzRes.links.some(l => l.includes('ref=') || l.includes('ref_=') || l.includes('utm_')), 'kept hrefs must contain no ref=, ref_=, or utm_ substrings');

  // Separate cap fixture: 30 links item-page-<n>
  const capEntries = Array.from({ length: 30 }, (_, i) => ({
    href: `https://www.amazon.in/item-page-${i + 1}`,
    text: `Item Page ${i + 1}`,
    inNav: false,
  }));
  const capRes = filterInternalLinks(capEntries, 'https://www.amazon.in/');
  assert.equal(capRes.links.length, 20, 'cap fixture links.length must be exactly 20');
  assert.equal(capRes.totalUnique, 30, 'cap fixture totalUnique must be exactly 30');
  console.log('   ✓ Group 5: Amazon-like fixture & separate cap fixture passed');

  // 6. filterInternalLinks Wikipedia / GitHub / BBC per spec
  console.log('6. filterInternalLinks Wikipedia / GitHub / BBC per spec...');
  // Wikipedia from https://en.wikipedia.org/wiki/Main_Page: /wiki/A, /wiki/B, /wiki/A#x
  const wikiRes = filterInternalLinks(
    ['https://en.wikipedia.org/wiki/A', 'https://en.wikipedia.org/wiki/B', 'https://en.wikipedia.org/wiki/A#x'],
    'https://en.wikipedia.org/wiki/Main_Page',
  );
  assert.equal(wikiRes.totalUnique, 2, 'wiki totalUnique must be 2');
  assert.ok(wikiRes.links.includes('https://en.wikipedia.org/wiki/A'), 'wiki /wiki/A kept');
  assert.ok(wikiRes.links.includes('https://en.wikipedia.org/wiki/B'), 'wiki /wiki/B kept');

  // GitHub from https://github.com/: /features, /pricing, /login?return_to=%2Ffoo
  const ghRes = filterInternalLinks(
    ['https://github.com/features', 'https://github.com/pricing', 'https://github.com/login?return_to=%2Ffoo'],
    'https://github.com/',
  );
  assert.equal(ghRes.links.length, 3, 'all 3 GitHub links kept');
  assert.ok(ghRes.links.some(l => l.includes('return_to=%2Ffoo') || l.includes('return_to')), 'return_to param preserved');

  // BBC from https://www.bbc.com/: /news, /news/articles/c123abc456, /news/articles/c987xyz123, /news/world-europe, /news/world-asia
  const bbcRes = filterInternalLinks(
    [
      'https://www.bbc.com/news',
      'https://www.bbc.com/news/articles/c123abc456',
      'https://www.bbc.com/news/articles/c987xyz123',
      'https://www.bbc.com/news/world-europe',
      'https://www.bbc.com/news/world-asia',
    ],
    'https://www.bbc.com/',
  );
  assert.ok(bbcRes.links.includes('https://www.bbc.com/news'), '/news kept');
  const bbcArticleLinks = bbcRes.links.filter(l => l.includes('/news/articles/'));
  assert.equal(bbcArticleLinks.length, 1, 'article IDs collapse to exactly one /news/articles/ entry');
  assert.ok(bbcRes.links.some(l => l.includes('/news/world-europe')), '/news/world-europe kept');
  assert.ok(bbcRes.links.some(l => l.includes('/news/world-asia')), '/news/world-asia kept');
  console.log('   ✓ Group 6: Wikipedia, GitHub, BBC template tests passed');

  // 7. isBotWall per spec
  console.log('7. Bot-wall detector (isBotWall)...');
  assert.equal(isBotWall('Amazon.in: Robot Check', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Login – The Internet', { hasChallengeDom: false }), false);
  assert.equal(isBotWall('Just a moment...', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Attention Required! | Cloudflare', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Access Denied', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Robot Check', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Please verify you are human', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Example Domain', { hasChallengeDom: true }), true);
  assert.equal(isBotWall('Example Domain', { hasChallengeDom: false }), false);
  assert.equal(isBotWall('Welcome to My Website', { hasChallengeDom: false }), false);
  console.log('   ✓ Group 7: isBotWall passed');

  // 8. Planner call cap with a REAL mock
  console.log('8. Planner call cap with real mock...');
  function plannerFixtureAppMap(): AppMap {
    const elements = Array.from({ length: 8 }, (_, i) => ({
      id: `elem-${i + 1}`, tagName: 'BUTTON', type: 'button' as const, detectedBy: 'native' as const,
      text: `Button ${i + 1}`, isVisible: true, isEnabled: true, isRequired: false, isReadOnly: false,
      selectors: { css: `#b${i}` },
    }));
    return {
      url: 'https://example.com/', title: 'Example', crawledAt: new Date().toISOString(),
      viewport: { width: 1280, height: 800 }, elements, forms: [], discoveredLinks: [],
      totalElementsFound: 8, isTruncated: false,
    } as unknown as AppMap;
  }

  function validPlanJson(n: number): string {
    return JSON.stringify({
      testCases: Array.from({ length: n }, (_, i) => ({
        id: `tc-${i + 1}`, title: `Case ${i + 1}`, description: 'fixture',
        steps: [
          { action: 'click', elementId: `elem-${i + 1}`, target: null, value: null, description: 'click it' },
          { action: 'assert_visible', elementId: `elem-${i + 1}`, target: null, value: null, description: 'still visible' },
        ],
      })),
    });
  }

  function recordingLlm(responses: string[], purposes: Array<string | undefined>) {
    let call = 0;
    return (async (req: { purpose?: string }) => {
      purposes.push(req.purpose);
      const content = responses[Math.min(call++, responses.length - 1)];
      return { content, model: 'mock', provider: 'groq', latencyMs: 1, usage: { promptTokens: 1, completionTokens: 1 } };
    }) as never;
  }

  // Case A (repair path)
  const purposesA: Array<string | undefined> = [];
  const planA = await planTests(plannerFixtureAppMap(), {
    fresh: true,
    callLlmImpl: recordingLlm(['not-json{', validPlanJson(3)], purposesA),
  });
  assert.equal(purposesA.length, 2, 'Repair path makes exactly 2 calls');
  assert.deepEqual(purposesA, ['plan', 'repair'], 'Repair path purposes must be plan, repair');
  assert.equal(planA.testCases.length, 3, 'Returned plan has 3 test cases');

  // Case B (expand path)
  const purposesB: Array<string | undefined> = [];
  const planB = await planTests(plannerFixtureAppMap(), {
    fresh: true,
    callLlmImpl: recordingLlm([validPlanJson(3), validPlanJson(6)], purposesB),
  });
  assert.equal(purposesB.length, 2, 'Expand path makes exactly 2 calls');
  assert.deepEqual(purposesB, ['plan', 'expand'], 'Expand path purposes must be plan, expand');
  assert.equal(planB.testCases.length, 6, 'Returned plan has 6 test cases');
  console.log('   ✓ Group 8: planner call cap & purposes (repair and expand paths) passed with real mock');

  // 9. Baseline tests (no smoke-3, no axe)
  console.log('9. Baseline tests inspection...');
  const fakeAppMap: AppMap = {
    url: 'https://example.com',
    title: 'Example Page',
    crawledAt: new Date().toISOString(),
    viewport: { width: 1280, height: 800 },
    elements: [],
    forms: [],
    discoveredLinks: ['https://example.com/about'],
    totalElementsFound: 0,
    isTruncated: false,
  };
  const baselines = buildBaselineTests(fakeAppMap);
  const ids = baselines.map(b => b.testCase.id);
  assert.ok(ids.includes('smoke-1'), 'Must include smoke-1');
  assert.ok(ids.includes('smoke-2'), 'Must include smoke-2');
  assert.ok(!ids.includes('smoke-3'), 'Must NOT include smoke-3');
  for (const b of baselines) {
    assert.ok(!b.code.includes('axe'), `Baseline ${b.filename} must not contain axe references`);
    assert.ok(!b.code.includes('@axe-core'), `Baseline ${b.filename} must not contain @axe-core references`);
  }
  console.log('   ✓ Group 9: baseline tests contain smoke-1 and smoke-2 only; zero smoke-3 or axe references');

  // 10. codeSafety rejects @axe-core/playwright
  console.log('10. codeSafety rejects @axe-core/playwright...');
  const axeSpec = `
    import { test, expect } from '@playwright/test';
    import AxeBuilder from '@axe-core/playwright';

    test('a11y', async ({ page }) => {
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  `;
  const axeViolations = findUnsafeConstructs(axeSpec);
  assert.ok(axeViolations.length > 0, 'codeSafety must reject @axe-core/playwright');
  assert.ok(axeViolations.some(v => v.includes('@axe-core/playwright') || v.includes('module')), 'Violation mentions module or axe-core');
  console.log('   ✓ Group 10: codeSafety successfully rejects @axe-core/playwright');

  console.log('\n=== All 10 Batch QF2 Verification Tests Passed! ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
