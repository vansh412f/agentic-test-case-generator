import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeTargetUrl } from '../src/security/targetUrl.ts';
import { CrawlError } from '../src/crawler/crawlErrors.ts';
import { mapGotoError } from '../src/crawler/gotoErrors.ts';
import { sanitizeError } from '../src/runner/sanitizeError.ts';
import { summarizeFailure } from '../src/report/failureSummary.ts';
import { runQueue } from '../src/agent/runQueue.ts';
import { isStaleExpectation } from '../src/agent/staleExpectation.ts';
import { rewritePlaywrightImport } from '../src/runner/rewriteImport.ts';
import { toJobErrorMessage } from '../src/agent/pipeline.ts';
import { prisma } from '../src/db/client.ts';
import { countJobsForBudget } from '../src/security/dailyBudget.ts';
import type { AppMap } from '../src/crawler/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testNormalizeTargetUrl() {
  console.log('--- 1. normalizeTargetUrl ---');

  // Bare host
  assert.equal(normalizeTargetUrl('example.com'), 'https://example.com/');
  // www
  assert.equal(normalizeTargetUrl('www.example.com'), 'https://www.example.com/');
  // host:port
  assert.equal(normalizeTargetUrl('example.com:8080'), 'https://example.com:8080/');
  // localhost:5173 with localMode
  assert.equal(normalizeTargetUrl('localhost:5173', { localMode: true }), 'http://localhost:5173/');
  // localhost:5173 without localMode
  assert.equal(normalizeTargetUrl('localhost:5173', { localMode: false }), 'http://localhost:5173/');
  // Uppercase scheme
  assert.equal(normalizeTargetUrl('HTTP://EXAMPLE.COM/PATH'), 'http://example.com/PATH');
  // Trailing spaces
  assert.equal(normalizeTargetUrl('  https://example.com/test  '), 'https://example.com/test');

  // Unsupported scheme (ftp)
  assert.throws(
    () => normalizeTargetUrl('ftp://example.com'),
    (err: unknown) => err instanceof CrawlError && err.code === 'INVALID_URL' && err.details?.reason === 'unsupported_scheme',
  );

  // Credentials rejected
  assert.throws(
    () => normalizeTargetUrl('http://user:pass@example.com'),
    (err: unknown) => err instanceof CrawlError && err.code === 'INVALID_URL' && err.details?.reason === 'credentials',
  );

  console.log('✓ normalizeTargetUrl passed');
}

async function testErrorMapping() {
  console.log('--- 2. Error mapping ---');

  const enotfound = mapGotoError(new Error('getaddrinfo ENOTFOUND myapp.test'), 'http://myapp.test');
  assert.equal(enotfound.code, 'TARGET_UNREACHABLE');
  assert.equal(enotfound.details?.reason, 'dns_not_found');

  const eaiAgain = mapGotoError(new Error('getaddrinfo EAI_AGAIN myapp.test'), 'http://myapp.test');
  assert.equal(eaiAgain.code, 'TARGET_UNREACHABLE');
  assert.equal(eaiAgain.details?.reason, 'dns_temporary');

  const errRefused = mapGotoError(new Error('net::ERR_CONNECTION_REFUSED at http://localhost:3000'), 'http://localhost:3000');
  assert.equal(errRefused.code, 'TARGET_UNREACHABLE');
  assert.equal(errRefused.details?.reason, 'connection_refused');

  const errTls = mapGotoError(new Error('net::ERR_CERT_AUTHORITY_INVALID at https://mysite.com'), 'https://mysite.com');
  assert.equal(errTls.code, 'TARGET_UNREACHABLE');
  assert.equal(errTls.details?.reason, 'tls_error');

  const errRedirect = mapGotoError(new Error('net::ERR_TOO_MANY_REDIRECTS at https://mysite.com'), 'https://mysite.com');
  assert.equal(errRedirect.code, 'TARGET_UNREACHABLE');
  assert.equal(errRedirect.details?.reason, 'redirect_loop');

  const timeout = mapGotoError(new Error('Timeout 30000ms exceeded while navigating to https://mysite.com'), 'https://mysite.com');
  assert.equal(timeout.code, 'NAVIGATION_TIMEOUT');

  console.log('✓ Error mapping passed');
}

async function testSanitizeError() {
  console.log('--- 3. sanitizeError ---');

  // ANSI escape sequences
  const withAnsi = '\u001b[31mError:\u001b[39m \u001b[1mExpected\u001b[22m true to be false';
  assert.equal(sanitizeError(withAnsi), 'Error: Expected true to be false');

  // Windows path
  const winErr = 'at D:\\Files\\programs\\agentic-test-generator\\backend\\playwright-runner\\tests\\run-abc123\\my-test.spec.ts:15:10';
  assert.equal(sanitizeError(winErr), 'at my-test.spec.ts:15:10');

  // POSIX path
  const posixErr = 'at /var/app/playwright-runner/tests/capture-xyz789/my-test.spec.ts:20:8';
  assert.equal(sanitizeError(posixErr), 'at my-test.spec.ts:20:8');

  console.log('✓ sanitizeError passed');
}

async function testSummarizeFailure() {
  console.log('--- 4. summarizeFailure ---');

  // 1. Strict mode violation
  const strictErr = "strict mode violation: getByRole('button', { name: 'Submit' }) resolved to 3 elements";
  const strictSum = summarizeFailure(strictErr);
  assert.equal(strictSum.kind, 'ambiguous');
  assert.ok(strictSum.headline.includes('matched 3 elements'));

  // 2. Action timeout
  const actionErr = "locator.click: Timeout 5000ms exceeded.\nwaiting for getByRole('button', { name: 'Save' })";
  const actionSum = summarizeFailure(actionErr);
  assert.equal(actionSum.kind, 'action_timeout');
  assert.ok(actionSum.headline.includes('Could not click the "Save" button within 5s'));

  // 3. Test timeout
  const testTimeoutErr = 'Test timeout of 30000ms exceeded.';
  const timeoutSum = summarizeFailure(testTimeoutErr);
  assert.equal(timeoutSum.kind, 'test_timeout');
  assert.equal(timeoutSum.headline, 'The test took longer than 30s.');

  // 4. toBeVisible missing
  const visMissingErr = "expect(locator).toBeVisible()\nLocator: getByText('Welcome')\nError: element(s) not found";
  const visMissingSum = summarizeFailure(visMissingErr);
  assert.equal(visMissingSum.kind, 'element_missing');
  assert.ok(visMissingSum.headline.includes('it was not found on the page'));

  // 5. toHaveValue empty (new fixture)
  const haveValEmptyErr = `Error: expect(locator).toHaveValue(expected)
Locator: getByRole('textbox', { name: 'Username' })
Expected: "admin"
Received: ""`;
  const valSum = summarizeFailure(haveValEmptyErr);
  assert.equal(valSum.kind, 'assertion');
  assert.ok(valSum.headline.includes('it was empty'));

  // 6. toHaveURL with function predicate (new fixture)
  const urlPredErr = `Error: expect(page).toHaveURL(expected)
Expected: [Function: predicate]
Received: "https://example.com/checkout"`;
  const urlSum = summarizeFailure(urlPredErr);
  assert.equal(urlSum.kind, 'assertion');
  assert.ok(urlSum.headline.includes('Expected the page address to include the expected address; it was "https://example.com/checkout".'));

  // 7. axe toEqual diff (new fixture)
  const axeErr = `Error: expect(violations).toEqual(expected)
axe violations:
[
  {
    "id": "color-contrast",
    "impact": "serious"
  }
]`;
  const axeSum = summarizeFailure(axeErr);
  assert.equal(axeSum.kind, 'accessibility');
  assert.ok(axeSum.headline.includes('1 accessibility issue (color-contrast)'));

  console.log('✓ summarizeFailure passed');
}

async function testRunQueueClaim() {
  console.log('--- 5. runQueue.claim ---');

  const token1 = runQueue.claim({ visitorId: 'user-test-client-1', ipHash: 'hash-1' });
  assert.ok(token1, 'First claim should succeed');

  const token1Dup = runQueue.claim({ visitorId: 'user-test-client-1', ipHash: 'hash-1' });
  assert.equal(token1Dup, null, 'Concurrent claim from same client should return null');

  const token2 = runQueue.claim({ visitorId: 'user-test-client-2', ipHash: 'hash-2' });
  assert.ok(token2, 'Claim from different client should succeed');

  runQueue.releaseClaim(token1);
  runQueue.releaseClaim(token2);

  const token1Reclaim = runQueue.claim({ visitorId: 'user-test-client-1', ipHash: 'hash-1' });
  assert.ok(token1Reclaim, 'Claim after release should succeed');
  runQueue.releaseClaim(token1Reclaim);

  console.log('✓ runQueue.claim passed');
}

async function testStaleExpectation() {
  console.log('--- 6. isStaleExpectation ---');

  const mockAppMap: AppMap = {
    url: 'http://localhost:3000/app/buildsmith',
    title: 'Buildsmith',
    elements: [
      {
        id: 'el-1',
        type: 'button',
        page: 1,
        selectors: {
          css: '#new-project-btn',
          getByRole: "getByRole('button', { name: 'New Project' })",
        },
      },
    ],
    forms: [],
    discoveredLinks: [],
  };

  // Case 1: Buildsmith scenario: locator from start page, URL changed -> true
  const isStale = isStaleExpectation({
    failureClass: 'timeout',
    failureContext: {
      finalUrl: 'http://localhost:3000/app/dashboard',
      navigations: ['http://localhost:3000/app/buildsmith', 'http://localhost:3000/app/dashboard'],
    },
    error: "locator.click: Timeout 5000ms exceeded.\nwaiting for getByRole('button', { name: 'New Project' })",
    appMap: mockAppMap,
    startUrl: 'http://localhost:3000/app/buildsmith',
    isBaseline: false,
  });
  assert.equal(isStale, true, 'Should detect stale expectation when page moved and locator is from start page');

  // Case 2: Same page + missing element -> false
  const samePage = isStaleExpectation({
    failureClass: 'timeout',
    failureContext: {
      finalUrl: 'http://localhost:3000/app/buildsmith',
      navigations: ['http://localhost:3000/app/buildsmith'],
    },
    error: "locator.click: Timeout 5000ms exceeded.\nwaiting for getByRole('button', { name: 'New Project' })",
    appMap: mockAppMap,
    startUrl: 'http://localhost:3000/app/buildsmith',
    isBaseline: false,
  });
  assert.equal(samePage, false, 'Same page should not be stale');

  // Case 3: URL changed but locator NOT on start page -> false
  const differentLocator = isStaleExpectation({
    failureClass: 'timeout',
    failureContext: {
      finalUrl: 'http://localhost:3000/app/dashboard',
      navigations: ['http://localhost:3000/app/buildsmith', 'http://localhost:3000/app/dashboard'],
    },
    error: "locator.click: Timeout 5000ms exceeded.\nwaiting for getByRole('button', { name: 'Unrelated Button' })",
    appMap: mockAppMap,
    startUrl: 'http://localhost:3000/app/buildsmith',
    isBaseline: false,
  });
  assert.equal(differentLocator, false, 'Locator not on start page should not be stale');

  // Case 4: Baseline test -> never stale
  const baseline = isStaleExpectation({
    failureClass: 'timeout',
    failureContext: {
      finalUrl: 'http://localhost:3000/app/dashboard',
      navigations: ['http://localhost:3000/app/buildsmith', 'http://localhost:3000/app/dashboard'],
    },
    error: "locator.click: Timeout 5000ms exceeded.\nwaiting for getByRole('button', { name: 'New Project' })",
    appMap: mockAppMap,
    startUrl: 'http://localhost:3000/app/buildsmith',
    isBaseline: true,
  });
  assert.equal(baseline, false, 'Baseline test should never be stale');

  console.log('✓ isStaleExpectation passed');
}

async function testImportRewrite() {
  console.log('--- 7. rewritePlaywrightImport ---');

  const originalCode = `import { test, expect } from '@playwright/test';

test('sample test', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Demo');
});
`;

  const rewritten = rewritePlaywrightImport(originalCode, '../../agt-capture.ts');

  assert.ok(rewritten.includes('../../agt-capture.ts'), 'Rewritten code must import agt-capture');
  assert.ok(!rewritten.includes("from '@playwright/test'"), 'Original @playwright/test import should be replaced');
  assert.ok(originalCode.includes("from '@playwright/test'"), 'Original string must remain unmodified');

  console.log('✓ rewritePlaywrightImport passed');
}

async function testPipelineErrorMessage() {
  console.log('--- 8. toJobErrorMessage ---');

  const dnsErr = new Error('getaddrinfo ENOTFOUND invalid-sub.domain.test');
  const dnsMsg = toJobErrorMessage(dnsErr);
  assert.ok(!dnsMsg.includes('getaddrinfo'), 'Should not dump raw getaddrinfo');
  assert.ok(dnsMsg.includes('could not resolve invalid-sub.domain.test'), 'Should have human-readable DNS failure message');

  const connErr = new Error('connect ECONNREFUSED 127.0.0.1:9999');
  const connMsg = toJobErrorMessage(connErr);
  assert.ok(connMsg.includes('Connection refused'), 'Should describe connection refused');

  console.log('✓ toJobErrorMessage passed');
}

async function testConfigGuard() {
  console.log('--- 9. Config fatal guard in production ---');

  const tsxCli = path.join(__dirname, '../node_modules/tsx/dist/cli.mjs');
  const result = spawnSync(
    process.execPath,
    [
      tsxCli,
      '-e',
      `process.env.NODE_ENV = 'production';
process.env.LOCAL_AGENT_MODE = 'true';
process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
process.env.DIRECT_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
import('./src/config.ts');`,
    ],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'production', LOCAL_AGENT_MODE: 'true' },
    },
  );

  assert.equal(result.status, 1, 'Process must exit with status 1');
  const combined = (result.stderr || '') + (result.stdout || '');
  assert.ok(combined.includes('FATAL: LOCAL_AGENT_MODE'), 'Must log fatal error');

  console.log('✓ Config guard passed');
}

async function testBudgetQuotaExempt() {
  console.log('--- 10. Budget quotaExempt filter ---');

  // Verify Prisma client has Job.quotaExempt
  const testJob = await prisma.job.create({
    data: {
      targetUrl: 'http://test-quota-exempt.internal',
      status: 'completed',
      quotaExempt: true,
      visitorId: 'visitor-test-exempt',
      ipHash: 'iphash-test-exempt',
    },
  });

  const counts = await countJobsForBudget('visitor-test-exempt', null);
  assert.equal(counts.visitor, 0, 'quotaExempt jobs must not count towards daily budget');

  // Clean up test job
  await prisma.job.delete({ where: { id: testJob.id } });

  console.log('✓ Budget quotaExempt filter passed');
}

async function main() {
  console.log('=== Running Quick-Fix Batch Verification Suite ===\n');
  await testNormalizeTargetUrl();
  await testErrorMapping();
  await testSanitizeError();
  await testSummarizeFailure();
  await testRunQueueClaim();
  await testStaleExpectation();
  await testImportRewrite();
  await testPipelineErrorMessage();
  await testConfigGuard();
  await testBudgetQuotaExempt();
  console.log('\n=== ALL 10 QUICK-FIX SUITE TESTS PASSED ===');
}

main().catch((err) => {
  console.error('\n❌ Quick-fix suite failed:', err);
  process.exit(1);
});
