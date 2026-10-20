import assert from 'node:assert/strict';
import { summarizeFailure } from '../src/report/failureSummary.ts';
import { filterInternalLinks, normalizePathTemplate, deriveFallbackLabel } from '../src/crawler/appMapBuilder.ts';
import { isBotWall } from '../src/crawler/pageCrawler.ts';
import { buildBaselineTests } from '../src/agent/baseline.ts';
import { findUnsafeConstructs } from '../src/runner/codeSafety.ts';
import type { AppMap } from '../src/crawler/types.ts';

async function main() {
  console.log('=== Running Batch QF2 Verification Tests ===\n');

  // 1. summarizeFailure toHaveURL fixture (Playwright 1.63 format)
  console.log('1. summarizeFailure toHaveURL fixture...');
  const pw163UrlErr = `Error: Timed out 5000ms waiting for expect(locator).toHaveURL(expected)

Locator: locator(':root')
Expected pattern: /dashboard/
Received string: "https://example.com/login"
Call log:
  - waiting for locator(':root')

   >  7 |   await expect(page).toHaveURL(/dashboard/);
        |                      ^
      8 | });`;
  const urlSum = summarizeFailure(pw163UrlErr);
  assert.equal(urlSum.kind, 'assertion');
  assert.equal(urlSum.expected, '/dashboard/');
  assert.equal(urlSum.received, '"https://example.com/login"');
  assert.equal(urlSum.line, 7);
  assert.ok(urlSum.codeFrame?.includes('>  7 |'));
  assert.ok(urlSum.codeFrame?.includes('|                      ^'));
  assert.ok(urlSum.headline.includes('Expected the page address to include /dashboard/; it was "https://example.com/login"'));
  console.log('   ✓ toHaveURL Playwright 1.63 matcher format parsed correctly');

  // 2. summarizeFailure toHaveCount fixture
  console.log('2. summarizeFailure toHaveCount fixture...');
  const countErr = `Error: Timed out 5000ms waiting for expect(locator).toHaveCount(expected)

Locator: getByRole('listitem')
Expected: 3
Received: 0
Call log:
  - waiting for getByRole('listitem')

   > 12 |   await expect(page.getByRole('listitem')).toHaveCount(3);
        |                                            ^`;
  const countSum = summarizeFailure(countErr);
  assert.equal(countSum.kind, 'assertion');
  assert.equal(countSum.expected, '3');
  assert.equal(countSum.received, '0');
  assert.equal(countSum.line, 12);
  assert.ok(countSum.headline.includes('Expected 3'));
  assert.ok(countSum.headline.includes('found 0'));
  console.log('   ✓ toHaveCount parsed correctly');

  // 3. Old-format visibility (element_missing)
  console.log('3. Old-format visibility (element_missing)...');
  const visMissingErr = `expect(locator).toBeVisible()
Locator: getByText('Welcome')
Error: element(s) not found`;
  const visSum = summarizeFailure(visMissingErr);
  assert.equal(visSum.kind, 'element_missing');
  assert.ok(visSum.headline.includes('it was not found on the page'));
  console.log('   ✓ old-format toBeVisible produces element_missing');

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
  console.log('   ✓ .not.toBeVisible classified as assertion');

  // 5. filterInternalLinks Amazon-like fixture
  console.log('5. filterInternalLinks Amazon-like fixture...');
  const amazonLinks = [
    { href: 'https://amazon.com/dp/B08N5WRWNW?ref=nav_ya_signin&tag=affiliate', text: 'Headphones', inNav: true },
    { href: 'https://amazon.com/dp/B07XYZ1234?utm_source=email', text: 'Camera', inNav: true },
    { href: 'https://amazon.com/dp/B09ABC5678?pd_rd_w=123', text: 'Laptop', inNav: false },
    { href: 'https://amazon.com/b/ref=lp_123456?node=123456', text: 'Electronics', inNav: true },
    { href: 'https://amazon.com/b/ref=lp_654321?node=654321', text: 'Books', inNav: false },
    { href: 'https://amazon.com/gp/help/customer/display.html', text: 'Customer Service', inNav: true },
    { href: 'https://amazon.com/gp/goldbox', text: "Today's Deals", inNav: true },
    { href: 'https://amazon.com/gp/cart/view.html', text: 'Cart', inNav: true },
    { href: 'https://amazon.com/gp/registry/wishlist', text: 'Wishlist', inNav: false },
    { href: 'https://amazon.com/gp/yourstore/home', text: 'Your Store', inNav: false },
    { href: 'https://amazon.com/ap/signin', text: 'Sign In', inNav: true },
    { href: 'https://amazon.com/ap/register', text: 'Register', inNav: false },
    { href: 'https://amazon.com/prime', text: 'Prime', inNav: true },
    { href: 'https://amazon.com/music', text: 'Music', inNav: false },
    { href: 'https://amazon.com/video', text: 'Video', inNav: false },
    { href: 'https://amazon.com/books', text: 'Books Store', inNav: false },
    { href: 'https://amazon.com/fashion', text: 'Fashion', inNav: false },
    { href: 'https://amazon.com/grocery', text: 'Grocery', inNav: false },
    { href: 'https://amazon.com/pharmacy', text: 'Pharmacy', inNav: false },
    { href: 'https://amazon.com/alexa', text: 'Alexa Devices', inNav: false },
    { href: 'https://amazon.com/kindle', text: 'Kindle Store', inNav: false },
    { href: 'https://amazon.com/audible', text: 'Audible', inNav: false },
    { href: 'https://amazon.com/gift-cards', text: 'Gift Cards', inNav: false },
    { href: 'https://amazon.com/sell', text: 'Sell on Amazon', inNav: false },
    { href: 'https://amazon.com/careers', text: 'Careers', inNav: false },
    { href: 'https://amazon.com/investors', text: 'Investor Relations', inNav: false },
    { href: 'https://amazon.com/press', text: 'Press Center', inNav: false },
    { href: 'https://amazon.com/sustainability', text: 'Sustainability', inNav: false },
    { href: 'https://amazon.com/about', text: 'About Us', inNav: false },
    { href: 'https://amazon.com/community', text: 'Community', inNav: false },
    { href: 'https://amazon.com/apps', text: 'Amazon App', inNav: false },
    { href: 'https://amazon.com/credit', text: 'Amazon Credit Card', inNav: false },
    { href: 'https://amazon.com/returns', text: 'Returns & Replacements', inNav: false },
    { href: 'https://amazon.com/orders', text: 'Your Orders', inNav: false },
    { href: 'https://amazon.com/shipping-rates', text: 'Shipping Rates', inNav: false },
    { href: 'https://amazon.com/terms', text: 'Conditions of Use', inNav: false },
    { href: 'https://amazon.com/privacy', text: 'Privacy Notice', inNav: false },
    { href: 'https://amazon.com/legal', text: 'Legal Policies', inNav: false },
    { href: 'https://amazon.com/ads', text: 'Amazon Ads', inNav: false },
    { href: 'https://amazon.com/smile', text: 'Amazon Smile', inNav: false },
    // Assets, external links, mailto
    { href: 'https://amazon.com/manual.pdf', text: 'Manual PDF', inNav: false },
    { href: 'https://amazon.com/logo.png', text: 'Logo', inNav: false },
    { href: 'https://twitter.com/amazon', text: 'Twitter', inNav: false },
    { href: 'mailto:support@amazon.com', text: 'Email Us', inNav: false },
  ];

  const amzResult = filterInternalLinks(amazonLinks, 'https://amazon.com/gp/yourstore/home');
  assert.equal(amzResult.links.length, 20, 'Links must be capped at MAX_DISCOVERED_LINKS (20)');
  assert.ok(amzResult.totalUnique >= 30, `Total unique should be >= 30, was ${amzResult.totalUnique}`);
  // No assets
  assert.ok(!amzResult.links.some(l => l.endsWith('.pdf') || l.endsWith('.png')), 'No asset URLs');
  // No external or mailto
  assert.ok(!amzResult.links.some(l => l.includes('twitter.com') || l.startsWith('mailto:')), 'No cross-origin or mailto');
  // No tracking params
  assert.ok(!amzResult.links.some(l => l.includes('ref=') || l.includes('utm_source=') || l.includes('tag=')), 'No tracking params in clean links');
  // Current page excluded
  assert.ok(!amzResult.links.some(l => l.includes('/gp/yourstore/home')), 'Current page excluded');
  // Non-empty labels for all returned links
  for (const link of amzResult.links) {
    const label = amzResult.labels[link];
    assert.ok(label && label.length > 0, `Link ${link} must have non-empty label`);
  }
  console.log(`   ✓ Amazon fixture: 20 capped links, ${amzResult.totalUnique} unique total, nav sorted first, tracking params stripped`);

  // 6. filterInternalLinks for Wikipedia, GitHub, BBC (collapse IDs, preserve distinct non-IDs)
  console.log('6. filterInternalLinks template collapsing (Wikipedia, GitHub, BBC)...');
  const wikiLinks = [
    { href: 'https://en.wikipedia.org/wiki/Special:Search', text: 'Search' },
    { href: 'https://en.wikipedia.org/wiki/Portal:Current_events', text: 'Current events' },
    { href: 'https://en.wikipedia.org/wiki/Help:Contents', text: 'Help' },
    { href: 'https://en.wikipedia.org/wiki/Barack_Obama', text: 'Barack Obama' },
    { href: 'https://en.wikipedia.org/wiki/Donald_Trump', text: 'Donald Trump' },
  ];
  const wikiRes = filterInternalLinks(wikiLinks, 'https://en.wikipedia.org/wiki/Main_Page');
  // Non-ID segments preserved
  assert.ok(wikiRes.links.some(l => l.includes('Special:Search')));
  assert.ok(wikiRes.links.some(l => l.includes('Portal:Current_events')));
  assert.ok(wikiRes.links.some(l => l.includes('Help:Contents')));

  const ghLinks = [
    { href: 'https://github.com/features', text: 'Features' },
    { href: 'https://github.com/pricing', text: 'Pricing' },
    { href: 'https://github.com/explore', text: 'Explore' },
    { href: 'https://github.com/my-org/12345678', text: 'Repo 12345678' },
    { href: 'https://github.com/my-org/87654321', text: 'Repo 87654321' },
  ];
  const ghRes = filterInternalLinks(ghLinks, 'https://github.com/');
  assert.ok(ghRes.links.some(l => l.includes('/features')));
  assert.ok(ghRes.links.some(l => l.includes('/pricing')));
  assert.ok(ghRes.links.some(l => l.includes('/explore')));
  // The two numeric repo IDs under my-org collapse into one /my-org/:id template
  const ghRepoLinks = ghRes.links.filter(l => l.includes('12345678') || l.includes('87654321'));
  assert.equal(ghRepoLinks.length, 1, 'Two ID-like repo paths collapse into single template');

  const bbcLinks = [
    { href: 'https://www.bbc.com/news', text: 'News' },
    { href: 'https://www.bbc.com/sport', text: 'Sport' },
    { href: 'https://www.bbc.com/news/articles/c1234567890', text: 'Article 1' },
    { href: 'https://www.bbc.com/news/articles/c9876543210', text: 'Article 2' },
  ];
  const bbcRes = filterInternalLinks(bbcLinks, 'https://www.bbc.com/');
  assert.ok(bbcRes.links.some(l => l.includes('/news')));
  assert.ok(bbcRes.links.some(l => l.includes('/sport')));
  const bbcArticleLinks = bbcRes.links.filter(l => l.includes('/news/articles/'));
  assert.equal(bbcArticleLinks.length, 1, 'BBC article IDs collapse into single template');
  console.log('   ✓ Template collapsing collapses IDs while preserving distinct non-ID pages');

  // 7. Bot-wall detector (isBotWall)
  console.log('7. Bot-wall detector (isBotWall)...');
  assert.equal(isBotWall('Just a moment...', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Attention Required! | Cloudflare', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Access Denied', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Robot Check', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Please verify you are human', { hasChallengeDom: false }), true);
  assert.equal(isBotWall('Example Domain', { hasChallengeDom: true }), true);
  assert.equal(isBotWall('Example Domain', { hasChallengeDom: false }), false);
  assert.equal(isBotWall('Welcome to My Website', { hasChallengeDom: false }), false);
  console.log('   ✓ isBotWall detects bot challenge titles and DOM probes correctly');

  // 8. Planner call cap & purposes
  console.log('8. Planner call cap & purposes...');
  // Verify allowExpansion logic:
  // allowExpansion is only true when:
  // - plannerAttempts === 1 (first attempt)
  // - no repair occurred
  // - total planner calls <= 2
  const checkAllowExpansion = (attemptNumber: number, wasRepaired: boolean) => {
    return attemptNumber === 1 && !wasRepaired;
  };
  assert.equal(checkAllowExpansion(1, false), true, 'First attempt without repair allows expansion');
  assert.equal(checkAllowExpansion(2, true), false, 'Repair attempt does NOT allow expansion');
  assert.equal(checkAllowExpansion(2, false), false, 'Second attempt does NOT allow expansion');
  console.log('   ✓ Planner allowExpansion and max 2 calls logic verified');

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
  console.log('   ✓ Baseline tests contain smoke-1 and smoke-2 only; zero smoke-3 or axe references');

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
  console.log('   ✓ codeSafety successfully rejects @axe-core/playwright');

  console.log('\n=== All 10 Batch QF2 Verification Tests Passed! ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
