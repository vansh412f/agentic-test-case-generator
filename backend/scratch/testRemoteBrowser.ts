import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fsSync from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 1. Initial minimal env before any imports, loading real .env if present
const envPath = path.resolve(import.meta.dirname, '../.env');
if (fsSync.existsSync(envPath)) {
  const dotenv = await import('dotenv');
  const envRaw = dotenv.parse(fsSync.readFileSync(envPath, 'utf8'));
  for (const [k, v] of Object.entries(envRaw)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = 'postgresql://user:pass@localhost:5432/db';
process.env.LOCAL_AGENT_MODE = 'true';

import { config } from '../src/config.ts';
import {
  isRemoteBrowserActive,
  buildAuthenticatedBrowserWsUrl,
  getRemoteBrowserAllowSpec,
  getRedactedBrowserEndpoint,
  scrubBrowserWsSecrets,
} from '../src/browser/remoteBrowser.ts';
import { sanitizeError } from '../src/runner/sanitizeError.ts';
import { launchBrowser, crawlPage } from '../src/crawler/pageCrawler.ts';
import { observeAppMap } from '../src/crawler/observe.ts';
import { executeTests } from '../src/runner/executor.ts';
import { traceForAttempt } from '../src/runner/traceStore.ts';
import { playwrightRunnerEnv } from '../src/runner/childEnv.ts';
import { CrawlError } from '../src/crawler/crawlErrors.ts';
import { RunnerError } from '../src/runner/errors.ts';
import { compactHref, toPlannerView } from '../src/agent/plannerView.ts';
import { urlAssertPattern } from '../src/agent/steps/compiler.ts';
import { redactString, redactPayload } from '../src/observability/logger.ts';
import type { AppMap, InteractiveElement } from '../src/crawler/types.ts';

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
  console.log('====================================================');
  console.log(' STARTING REMOTE BROWSER TEST SUITE (RB1 - RB5)');
  console.log('====================================================\n');

  // ──────────────────────────────────────────────────────────
  // RB1: remoteBrowser + sanitizeError unit checks
  // ──────────────────────────────────────────────────────────
  await run('RB1 remoteBrowser + sanitizeError unit checks', async () => {
    const realWsEndpoint = (config as any).BROWSER_WS_ENDPOINT;
    const realWsToken = (config as any).BROWSER_WS_TOKEN;

    // When LOCAL_AGENT_MODE=true, isRemoteBrowserActive is always false
    (config as any).LOCAL_AGENT_MODE = true;
    (config as any).BROWSER_WS_ENDPOINT = 'wss://browser.example.com/chromium/playwright';
    (config as any).BROWSER_WS_TOKEN = 'secret-token-12345678901234567890';
    assert.equal(isRemoteBrowserActive(), false);

    // When LOCAL_AGENT_MODE=false + BROWSER_WS_ENDPOINT set, isRemoteBrowserActive is true
    (config as any).LOCAL_AGENT_MODE = false;
    assert.equal(isRemoteBrowserActive(), true);

    // buildAuthenticatedBrowserWsUrl
    const authWsUrl = buildAuthenticatedBrowserWsUrl();
    assert.equal(
      authWsUrl,
      'wss://browser.example.com/chromium/playwright?token=secret-token-12345678901234567890',
    );

    // getRemoteBrowserAllowSpec
    assert.equal(getRemoteBrowserAllowSpec(), 'browser.example.com:443');

    (config as any).BROWSER_WS_ENDPOINT = 'ws://127.0.0.1:9222/ws';
    assert.equal(getRemoteBrowserAllowSpec(), '127.0.0.1:9222');

    // getRedactedBrowserEndpoint
    (config as any).BROWSER_WS_ENDPOINT = 'wss://browser.example.com/chromium/playwright?token=leak';
    const redacted = getRedactedBrowserEndpoint();
    assert.equal(redacted, 'wss://browser.example.com/chromium/playwright?token=[REDACTED]');

    // scrubBrowserWsSecrets
    const scrubbed1 = scrubBrowserWsSecrets('Error at wss://example.com/ws?token=secret-token-12345678901234567890 in connection');
    assert(!scrubbed1.includes('secret-token-12345678901234567890'));
    assert(scrubbed1.includes('[REDACTED]'));

    // sanitizeError strips ?token= and raw BROWSER_WS_TOKEN
    process.env.BROWSER_WS_TOKEN = 'secret-token-12345678901234567890';
    const sanitized = sanitizeError('Failed: connection to ws://host/pw?token=secret-token-12345678901234567890 rejected');
    assert(!sanitized.includes('secret-token-12345678901234567890'));
    assert(sanitized.includes('[REDACTED]'));

    // Restore real env
    (config as any).LOCAL_AGENT_MODE = true;
    (config as any).BROWSER_WS_ENDPOINT = realWsEndpoint;
    (config as any).BROWSER_WS_TOKEN = realWsToken;
    process.env.BROWSER_WS_TOKEN = realWsToken;
    pass('RB1 remoteBrowser + sanitizeError unit checks');
  });

  // ──────────────────────────────────────────────────────────
  // RB2: config.ts production fail-closed checks via child process
  // ──────────────────────────────────────────────────────────
  await run('RB2 config.ts production fail-closed checks', async () => {
    async function testChildConfig(env: Record<string, string>): Promise<{ code: number; stderr: string }> {
      return new Promise((resolve) => {
        const script = `
          import './src/config.ts';
          console.log('LOADED_OK');
        `;
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', '--no-warnings', '-e', script],
          {
            cwd: path.resolve(import.meta.dirname, '..'),
            env: {
              ...process.env,
              ...env,
            },
          },
        );
        let out = '';
        child.stdout.on('data', (d) => (out += d.toString()));
        child.stderr.on('data', (d) => (out += d.toString()));
        child.on('close', (code) => {
          resolve({ code: code ?? 0, stderr: out });
        });
      });
    }

    const baseProdEnv = {
      NODE_ENV: 'production',
      LOCAL_AGENT_MODE: 'false',
      RUNNER_ISOLATION: 'uid',
      VISITOR_SIGNING_SECRET: 'visitor_signing_secret_1234567890',
      POW_SECRET: 'pow_secret_1234567890',
      ADMIN_SECRET: 'admin_secret_at_least_24_chars_long_123',
      EDGE_SHARED_SECRET: 'edge_shared_secret_at_least_24_chars',
      FRONTEND_ORIGIN: 'https://app.example.com',
      GROQ_API_KEY: 'gsk_fake_key_123',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      DIRECT_URL: 'postgresql://u:p@localhost:5432/db',
    };

    // 1. ws:// rejected in production
    const res1 = await testChildConfig({
      ...baseProdEnv,
      BROWSER_WS_ENDPOINT: 'ws://insecure.example.com/pw',
      BROWSER_WS_TOKEN: 'secret_token_at_least_24_chars_long',
    });
    assert.equal(res1.code, 1);
    assert(res1.stderr.includes('BROWSER_WS_ENDPOINT (must start with wss:// in production)'));

    // 2. wss:// with missing token rejected in production
    const res2 = await testChildConfig({
      ...baseProdEnv,
      BROWSER_WS_ENDPOINT: 'wss://secure.example.com/pw',
      BROWSER_WS_TOKEN: '',
    });
    assert.equal(res2.code, 1);
    assert(res2.stderr.includes('BROWSER_WS_TOKEN (must be at least 24 characters in production)'));

    // 3. wss:// with short token (< 24 chars) rejected in production
    const res3 = await testChildConfig({
      ...baseProdEnv,
      BROWSER_WS_ENDPOINT: 'wss://secure.example.com/pw',
      BROWSER_WS_TOKEN: 'short_token_123',
    });
    assert.equal(res3.code, 1);
    assert(res3.stderr.includes('BROWSER_WS_TOKEN (must be at least 24 characters in production)'));

    pass('RB2 config.ts production fail-closed checks');
  });

  // ──────────────────────────────────────────────────────────
  // RB3: Strict No-Local-Fallback Guarantee
  // ──────────────────────────────────────────────────────────
  await run('RB3 Strict No-Local-Fallback Guarantee', async () => {
    (config as any).LOCAL_AGENT_MODE = false;
    (config as any).BROWSER_WS_ENDPOINT = 'ws://127.0.0.1:1/chromium/playwright';
    (config as any).BROWSER_WS_TOKEN = 'fake_secret_token_for_fallback_test_123456';

    const originalConsoleError = console.error;
    let loggedErrors = '';
    console.error = (...args: any[]) => {
      loggedErrors += args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
    };

    let caughtErr: any;
    try {
      await launchBrowser();
    } catch (err: any) {
      caughtErr = err;
    } finally {
      console.error = originalConsoleError;
      (config as any).LOCAL_AGENT_MODE = true;
      (config as any).BROWSER_WS_ENDPOINT = undefined;
      (config as any).BROWSER_WS_TOKEN = undefined;
    }

    assert(caughtErr instanceof CrawlError, 'Expected CrawlError to be thrown');
    assert.equal(caughtErr.code, 'BROWSER_LAUNCH_FAILED');
    // Assert secret token never appeared in logs or caught error
    assert(!loggedErrors.includes('fake_secret_token_for_fallback_test_123456'), 'Secret token leaked in logs');
    assert(!caughtErr.message.includes('fake_secret_token_for_fallback_test_123456'), 'Secret token leaked in error');

    pass('RB3 Strict No-Local-Fallback Guarantee');
  });

  // ──────────────────────────────────────────────────────────
  // RB4: playwrightRunnerEnv + netGuard.mjs remote allowlist barrier
  // ──────────────────────────────────────────────────────────
  await run('RB4 playwrightRunnerEnv + netGuard.mjs remote barrier', async () => {
    (config as any).LOCAL_AGENT_MODE = false;
    (config as any).BROWSER_WS_ENDPOINT = 'wss://browser.example.com/chromium/playwright';
    (config as any).BROWSER_WS_TOKEN = 'token_for_env_check_1234567890';

    const env = playwrightRunnerEnv('fake-results.json', { TEST_EXTRA: '1' });
    assert.equal(
      env.AGT_BROWSER_WS_ENDPOINT,
      'wss://browser.example.com/chromium/playwright?token=token_for_env_check_1234567890',
    );
    assert.equal(env.AGT_REMOTE_BROWSER_ALLOW, 'browser.example.com:443');
    assert.equal(env.AGT_EGRESS_PROXY, undefined);
    assert(env.NODE_OPTIONS?.includes('--import='));
    // Ensure secrets and credentials not passed to child
    assert.equal(env.BROWSER_WS_TOKEN, undefined);
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.GROQ_API_KEY, undefined);

    (config as any).LOCAL_AGENT_MODE = true;
    (config as any).BROWSER_WS_ENDPOINT = undefined;
    (config as any).BROWSER_WS_TOKEN = undefined;

    // Test netGuard.mjs TCP hook behavior directly with child process
    const s1 = net.createServer((sock) => {
      sock.write('OK_S1');
      sock.end();
    });
    const s2 = net.createServer((sock) => {
      sock.write('OK_S2');
      sock.end();
    });

    await new Promise<void>((res) => s1.listen(0, '127.0.0.1', res));
    await new Promise<void>((res) => s2.listen(0, '127.0.0.1', res));

    const p1 = (s1.address() as net.AddressInfo).port;
    const p2 = (s2.address() as net.AddressInfo).port;

    const netGuardPath = path.resolve(import.meta.dirname, '../playwright-runner/netGuard.mjs');
    const netGuardUrl = pathToFileURL(netGuardPath).href;

    const testScript = `
      import net from 'node:net';

      async function testPort(port) {
        return new Promise((resolve, reject) => {
          const s = net.connect({ host: '127.0.0.1', port }, () => {
            s.end();
            resolve('CONNECTED');
          });
          s.on('error', reject);
        });
      }

      const p1 = ${p1};
      const p2 = ${p2};

      try {
        await testPort(p1);
        console.log('P1_SUCCESS');
      } catch (err) {
        console.log('P1_ERROR:' + err.code);
      }

      try {
        await testPort(p2);
        console.log('P2_SUCCESS');
      } catch (err) {
        console.log('P2_ERROR:' + (err.code || err.message));
      }
    `;

    const child = spawn(
      process.execPath,
      ['--import', netGuardUrl, '-e', testScript],
      {
        env: {
          ...process.env,
          AGT_REMOTE_BROWSER_ALLOW: `127.0.0.1:${p1}`,
        },
      },
    );

    let childOutput = '';
    child.stdout.on('data', (d) => (childOutput += d.toString()));
    child.stderr.on('data', (d) => (childOutput += d.toString()));
    await new Promise<void>((resolve) => child.on('close', () => resolve()));

    await new Promise<void>((res) => s1.close(() => res()));
    await new Promise<void>((res) => s2.close(() => res()));

    assert(childOutput.includes('P1_SUCCESS'), `Expected P1 to connect successfully, got: ${childOutput}`);
    assert(childOutput.includes('P2_ERROR:EACCES'), `Expected P2 to be blocked with EACCES, got: ${childOutput}`);

    pass('RB4 playwrightRunnerEnv + netGuard.mjs remote barrier');
  });

  // ──────────────────────────────────────────────────────────
  // RB5: Live Integrated Production Path -> Cloud Run
  // ──────────────────────────────────────────────────────────
  await run('RB5 Live Integrated Production Path -> Cloud Run agt-playwright-ws', async () => {
    // Read environment from backend/.env if not present in process.env
    const envPath = path.resolve(import.meta.dirname, '../.env');
    if (fsSync.existsSync(envPath)) {
      const dotenv = await import('dotenv');
      const envRaw = dotenv.parse(fsSync.readFileSync(envPath, 'utf8'));
      if (!process.env.BROWSER_WS_ENDPOINT && envRaw.BROWSER_WS_ENDPOINT) {
        process.env.BROWSER_WS_ENDPOINT = envRaw.BROWSER_WS_ENDPOINT;
      }
      if (!process.env.BROWSER_WS_TOKEN && envRaw.BROWSER_WS_TOKEN) {
        process.env.BROWSER_WS_TOKEN = envRaw.BROWSER_WS_TOKEN;
      }
    }

    assert(process.env.BROWSER_WS_ENDPOINT, 'BROWSER_WS_ENDPOINT must be set in backend/.env for RB5 live test');
    assert(process.env.BROWSER_WS_TOKEN, 'BROWSER_WS_TOKEN must be set in backend/.env for RB5 live test');

    // Activate remote browser in config
    (config as any).LOCAL_AGENT_MODE = false;
    (config as any).BROWSER_WS_ENDPOINT = process.env.BROWSER_WS_ENDPOINT;
    (config as any).BROWSER_WS_TOKEN = process.env.BROWSER_WS_TOKEN;

    try {
      // 1. Live crawlPage against example.com
      console.log('  [RB5.1] Executing live crawlPage("https://example.com")...');
      const appMap = await crawlPage('https://example.com');
      assert(appMap.url.includes('example.com'));
      assert(appMap.title.length > 0);
      assert(Array.isArray(appMap.elements));
      console.log(`  ✓ Live crawlPage succeeded: title="${appMap.title}", elements=${appMap.elements.length}`);

      // 2. Live observeAppMap against example.com
      console.log('  [RB5.2] Executing live observeAppMap...');
      const observations = await observeAppMap(appMap, { deadlineMs: 20_000 });
      assert(Array.isArray(observations));
      console.log(`  ✓ Live observeAppMap succeeded: ${observations.length} observations`);

      // 3. Live executeTests with secret replacement and trace capture
      console.log('  [RB5.3] Executing live executeTests with traces and secrets...');
      const runId = `rb5-live-${Date.now()}`;
      const jobId = `job-rb5-${Date.now()}`;
      const visitorId = '';
      const secretValue = 'LiveSecret99!';

      const passingSpec = {
        filename: 'tc-pass.spec.ts',
        code: `
          import { test, expect } from '@playwright/test';
          test('pass live', async ({ page }) => {
            const resp = await page.request.get('https://example.com');
            expect(resp.status()).toBe(200);
            await page.goto('https://example.com');
            const sec = '__SECRET_TOKEN__';
            expect(sec).toBe('${secretValue}');
          });
        `,
      };

      const failingSpec = {
        filename: 'tc-fail.spec.ts',
        code: `
          import { test, expect } from '@playwright/test';
          test('fail live', async ({ page }) => {
            await page.goto('https://example.com');
            const sec = '__SECRET_TOKEN__';
            expect(1).toBe(2);
          });
        `,
      };

      const { registerTrace } = await import('../src/runner/traceStore.ts');

      const execResult = await executeTests(
        runId,
        [passingSpec, failingSpec],
        {
          secrets: new Map([['__SECRET_TOKEN__', secretValue]]),
          trace: true,
          onTraceZips: async (traces) => {
            for (const [stem, zipPath] of traces.entries()) {
              await registerTrace(zipPath, {
                jobId,
                testCaseId: stem,
                attemptNumber: 1,
                visitorId,
              });
            }
          },
        },
      );

      assert.equal(execResult.results.length, 2);
      const passRes = execResult.results.find((r) => r.testCaseId === 'tc-pass');
      const failRes = execResult.results.find((r) => r.testCaseId === 'tc-fail');

      assert(passRes, 'Expected tc-pass result');
      assert.equal(passRes.passed, true);

      assert(failRes, 'Expected tc-fail result');
      assert.equal(failRes.passed, false);
      assert.equal(failRes.failureClass, 'finding');
      assert(failRes.failureContext?.finalUrl.startsWith('https://example.com'));

      // Check traces registered and retrievable
      const tracePass = traceForAttempt(jobId, 'tc-pass', 1, visitorId);
      const traceFail = traceForAttempt(jobId, 'tc-fail', 1, visitorId);
      assert(tracePass, 'Expected tracePass in registry');
      assert(traceFail, 'Expected traceFail in registry');
      assert(tracePass.sizeBytes > 1000);
      assert(traceFail.sizeBytes > 1000);

      // Verify zero leak of secretValue or token in error output
      const failError = failRes.error || '';
      assert(!failError.includes(secretValue), 'Secret leaked in test failure message');
      assert(!failError.includes(process.env.BROWSER_WS_TOKEN!), 'Browser token leaked in error');

      console.log(`  ✓ Live executeTests completed: tc-pass passed, tc-fail failed with finding, traces verified`);
    } finally {
      (config as any).LOCAL_AGENT_MODE = true;
      (config as any).BROWSER_WS_ENDPOINT = undefined;
      (config as any).BROWSER_WS_TOKEN = undefined;
    }

    pass('RB5 Live Integrated Production Path -> Cloud Run agt-playwright-ws');
  });

  // ──────────────────────────────────────────────────────────
  // RB6: compactHref + plannerView compaction & browserType.connect classification
  // ──────────────────────────────────────────────────────────
  await run('RB6 compactHref + plannerView compaction & browserType.connect classification', async () => {
    const baseUrl = 'https://www.flipkart.com/';

    // 1. Fast-path preservation of normal, relative, and hash URLs
    assert.equal(compactHref('/about', baseUrl), '/about');
    assert.equal(compactHref('#/settings', baseUrl), '#/settings');
    assert.equal(compactHref('https://example.com/items?page=2', baseUrl), 'https://example.com/items?page=2');
    assert.equal(compactHref('', baseUrl), undefined);
    assert.equal(compactHref('   ', baseUrl), undefined);
    assert.equal(compactHref(null, baseUrl), undefined);

    // 2. Flipkart-style long tracking query strings
    const longTrackingQuery = '?fm=neo%2Fmerchandising&iid=M_8e6d9d1b-8777-4c78-b1fb-429bb467948a.D5W0XQ18W6EZ&otracker=hp_rich_navigation_1_1.navigationCard.RICH_NAVIGATION_Electronics~Audio~All_D5W0XQ18W6EZ&otracker1=hp_rich_navigation_PINNED_neo%2Fmerchandising_NA_NAV_EXPANDABLE_navigationCard_cc_1_L2_view-all&cid=D5W0XQ18W6EZ&p%5B%5D=facets.brand%255B%255D%3DboAt&marketplace=FLIPKART&page=1&ref=12345678901234567890123456789012345678901234567890';
    const longUrl = `https://www.flipkart.com/audio-store${longTrackingQuery}`;
    assert(longUrl.length > 250);

    const compacted = compactHref(longUrl, baseUrl);
    assert.equal(compacted, 'https://www.flipkart.com/audio-store');

    // Test that the compiled urlAssertPattern matches the original full URL
    const pattern = urlAssertPattern(compacted!);
    const regex = new RegExp(pattern);
    assert(regex.test(longUrl), 'urlAssertPattern regex must match the original full tracking URL');

    // Test that a path whose origin + pathname alone exceeds 160 chars returns undefined
    const hugePath = 'https://www.flipkart.com/' + 'a'.repeat(200);
    assert.equal(compactHref(hugePath, baseUrl), undefined);

    // 3. Mega-site AppMap compaction (200 links with 700-char tracking strings + 25 discovered links)
    const megaElements: InteractiveElement[] = [];
    for (let i = 0; i < 200; i++) {
      const tracking = '?q=' + 'x'.repeat(700);
      megaElements.push({
        id: `el-${i}`,
        tagName: 'a',
        type: 'link',
        detectedBy: 'native',
        text: `Product ${i}`,
        isVisible: true,
        isEnabled: true,
        selectors: { css: `a#el-${i}` },
        href: `https://www.flipkart.com/product-${i}${tracking}`,
      });
    }

    const megaDiscoveredLinks: string[] = [];
    for (let i = 0; i < 30; i++) {
      megaDiscoveredLinks.push(`https://www.flipkart.com/category-${i}?tracking=` + 'y'.repeat(700));
    }

    const megaAppMap: AppMap = {
      url: baseUrl,
      title: 'Flipkart Online Shopping',
      crawledAt: new Date().toISOString(),
      viewport: { width: 1280, height: 720 },
      elements: megaElements,
      discoveredLinks: megaDiscoveredLinks,
      totalElementsFound: 200,
      isTruncated: false,
    };

    const plannerView = toPlannerView(megaAppMap);
    const viewJson = JSON.stringify(plannerView);
    assert(viewJson.length < 25_000, `Expected plannerView JSON < 25000 chars, got ${viewJson.length}`);
    assert.equal(plannerView.elements.length, 200);
    assert.equal(plannerView.discoveredLinks.length, 25);
    for (const el of plannerView.elements) {
      assert(el.href?.startsWith('https://www.flipkart.com/product-'));
      assert(!el.href.includes('?q='), 'Query string must be stripped');
    }

    // 4. executor.ts browserType.connect classification as RunnerError('BROWSER_ERROR')
    (config as any).LOCAL_AGENT_MODE = false;
    (config as any).BROWSER_WS_ENDPOINT = 'ws://127.0.0.1:1/chromium/playwright';
    (config as any).BROWSER_WS_TOKEN = 'secret_connect_fail_token_9876543210';

    let caughtConnectErr: any;
    try {
      await executeTests(
        `rb6-connect-test-${Date.now()}`,
        [
          {
            filename: 'connect-fail.spec.ts',
            code: `import { test } from '@playwright/test'; test('noop', async ({ page }) => {});`,
          },
        ],
        { timeoutMs: 15_000 },
      );
    } catch (err: any) {
      caughtConnectErr = err;
    } finally {
      (config as any).LOCAL_AGENT_MODE = true;
      (config as any).BROWSER_WS_ENDPOINT = undefined;
      (config as any).BROWSER_WS_TOKEN = undefined;
    }

    assert(caughtConnectErr instanceof RunnerError, 'Expected RunnerError to be thrown');
    assert.equal(caughtConnectErr.code, 'BROWSER_ERROR');
    assert(
      !caughtConnectErr.message.includes('secret_connect_fail_token_9876543210'),
      'Secret token leaked in RunnerError message',
    );

    // 5. logger.ts token query param and sensitive key scrubbing
    const logScrubbed1 = redactString('Failed to connect to ws://127.0.0.1:8080/chromium/playwright?token=secret123&other=val');
    assert.equal(
      logScrubbed1,
      'Failed to connect to ws://127.0.0.1:8080/chromium/playwright?token=[REDACTED]&other=val',
    );
    const logScrubbed2 = redactString('connecting to https://example.com/api?foo=1&token=xyz789');
    assert.equal(logScrubbed2, 'connecting to https://example.com/api?foo=1&token=[REDACTED]');

    assert.equal(redactPayload('browser_ws_token', 'my-secret-token'), '[REDACTED]');
    assert.equal(redactPayload('edge_shared_secret', 'my-edge-secret'), '[REDACTED]');
    const objRedacted = redactPayload('config', {
      browser_ws_token: 'secret123',
      nested: { edge_shared_secret: 'edge456', url: 'wss://host?token=secret789' },
    }) as any;
    assert.equal(objRedacted.browser_ws_token, '[REDACTED]');
    assert.equal(objRedacted.nested.edge_shared_secret, '[REDACTED]');
    assert.equal(objRedacted.nested.url, 'wss://host?token=[REDACTED]');

    pass('RB6 compactHref + plannerView compaction & browserType.connect classification');
  });

  console.log('\n====================================================');
  if (failures === 0) {
    console.log(' ALL REMOTE BROWSER TESTS (RB1 - RB6) PASSED');
  } else {
    console.error(` ${failures} TEST(S) FAILED`);
    process.exit(1);
  }
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('Fatal error in testRemoteBrowser suite:', err);
  process.exit(1);
});
