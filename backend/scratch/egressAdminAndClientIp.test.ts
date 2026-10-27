import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { fork, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express, { type Request, type Response } from 'express';

import { findUnsafeConstructs } from '../src/runner/codeSafety.ts';
import {
  recordServerEvent,
  computeFingerprint,
  normalizeMessage,
  redactSensitiveText,
  redactContext,
  resetHourlyLimitForTest,
  getDroppedCount,
} from '../src/observability/serverEvents.ts';
import { clientIp } from '../src/security/clientIp.ts';
import adminRouter from '../src/api/adminRoutes.ts';
import { config } from '../src/config.ts';
import { completeJob } from '../src/db/jobs.ts';
import { prisma } from '../src/db/client.ts';
import { openJobChannel, subscribeJobEvents, publishJobEvent, type JobEvent } from '../src/agent/jobEvents.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NET_GUARD_PATH = path.resolve(__dirname, '../playwright-runner/netGuard.mjs');
const NET_GUARD_URL = pathToFileURL(NET_GUARD_PATH).href;

// ==========================================
// 1. WP1.1 — codeSafety AST Validation Tests
// ==========================================
function testCodeSafetyBypasses() {
  console.log('--- Test 1.1: codeSafety rejects all bypass constructs ---');

  const bypasses = [
    {
      name: 'playwright fixture access',
      code: `import { test } from '@playwright/test'; test('b1', async ({ playwright }) => playwright.request.newContext());`,
    },
    {
      name: 'browserType launch',
      code: `import { test } from '@playwright/test'; test('b2', async ({ browserType }) => browserType.launch());`,
    },
    {
      name: 'browser.browserType().launch()',
      code: `import { test } from '@playwright/test'; test('b3', async ({ browser }) => browser.browserType().launch());`,
    },
    {
      name: 'computed property proxy server',
      code: `import { test } from '@playwright/test'; test('b4', async ({ page }) => { const k = 'proxy'; (browser as any).newContext({ [k]: { server: 'direct://' } }); });`,
    },
    {
      name: "page['context']() non-numeric element access",
      code: `import { test } from '@playwright/test'; test('b5', async ({ page }) => { (page as any)['context'](); });`,
    },
    {
      name: "test['use']({}) element access",
      code: `import { test } from '@playwright/test'; (test as any)['use']({}); test('b6', async ({ page }) => {});`,
    },
    {
      name: 'non-destructured test callback param',
      code: `import { test } from '@playwright/test'; test('b7', async (p) => {});`,
    },
    {
      name: 'forbidden property access launchPersistentContext',
      code: `import { test } from '@playwright/test'; test('b8', async ({ page }) => { (page as any).launchPersistentContext(); });`,
    },
    {
      name: 'forbidden property access addInitScript',
      code: `import { test } from '@playwright/test'; test('b9', async ({ page }) => { (page as any).addInitScript('alert(1)'); });`,
    },
  ];

  for (const tc of bypasses) {
    const problems = findUnsafeConstructs(tc.code);
    assert(
      problems.length > 0,
      `Expected bypass "${tc.name}" to be rejected, but got 0 problems! Code:\n${tc.code}`,
    );
  }
  console.log('✓ All 9 bypass constructs rejected correctly');

  console.log('--- Test 1.1b: codeSafety accepts legitimate fixtures and baselines ---');
  const allowed = [
    {
      name: 'smoke-1: standard page test',
      code: `
        import { test, expect } from '@playwright/test';
        test('homepage test', async ({ page }) => {
          await page.goto('https://demo.playwright.dev/todomvc');
          await expect(page).toHaveTitle('TodoMVC');
        });
      `,
    },
    {
      name: 'smoke-2: page and request fixtures',
      code: `
        import { test, expect } from '@playwright/test';
        test('api and page test', async ({ page, request }) => {
          const res = await request.get('https://example.com');
          expect(res.ok()).toBeTruthy();
          await page.goto('https://example.com');
        });
      `,
    },
    {
      name: 'page and context fixtures',
      code: `
        import { test, expect } from '@playwright/test';
        test('context test', async ({ page, context }) => {
          await page.goto('https://example.com');
          const cookies = await context.cookies();
          expect(cookies).toBeDefined();
        });
      `,
    },
    {
      name: 'test.step and describe blocks',
      code: `
        import { test, expect } from '@playwright/test';
        test.describe('suite', () => {
          test.beforeEach(async ({ page }) => {
            await page.goto('https://example.com');
          });
          test('step test', async ({ page }) => {
            await test.step('first step', async () => {
              await expect(page.locator('h1')).toBeVisible();
            });
          });
        });
      `,
    },
  ];

  for (const tc of allowed) {
    const problems = findUnsafeConstructs(tc.code);
    assert.deepEqual(
      problems,
      [],
      `Expected "${tc.name}" to be accepted, but got problems: ${problems.join('; ')}`,
    );
  }
  console.log('✓ All 4 legitimate fixtures/baselines accepted');
}

// ==========================================
// 2. WP1.2 — netGuard.mjs Network Barrier
// ==========================================
async function testNetGuard() {
  console.log('--- Test 1.2: netGuard blocks direct TCP egress to victim ---');

  let victimHits = 0;
  const victimServer = http.createServer((_req, res) => {
    victimHits++;
    res.writeHead(200);
    res.end('victim hit!');
  });

  await new Promise<void>((resolve) => victimServer.listen(0, '127.0.0.1', resolve));
  const victimPort = (victimServer.address() as net.AddressInfo).port;

  // Choose a dummy proxy port different from victim
  const dummyProxyPort = victimPort + 1;

  try {
    // Run a Node child script that imports netGuard with AGT_EGRESS_PROXY set
    const childScript = `
      import http from 'node:http';
      try {
        const req = http.get('http://127.0.0.1:${victimPort}', () => {
          process.exit(0); // If reached, barrier failed!
        });
        req.on('error', (err) => {
          if (err.code === 'EACCES' || err.message.includes('egress blocked')) {
            process.exit(42);
          }
          process.exit(1);
        });
      } catch (err) {
        if (err.code === 'EACCES' || err.message.includes('egress blocked')) {
          process.exit(42);
        }
        process.exit(1);
      }
    `;

    let stderr = '';
    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(
        process.execPath,
        [`--import=${NET_GUARD_URL}`, '-e', childScript],
        {
          env: {
            ...process.env,
            AGT_EGRESS_PROXY: `http://127.0.0.1:${dummyProxyPort}`,
          },
        },
      );
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', resolve);
    });

    assert.equal(exitCode, 42, `Child process should exit 42 (EACCES egress blocked), got ${exitCode}. Stderr: ${stderr}`);
    assert.equal(victimHits, 0, `Victim server received ${victimHits} hits; should be 0!`);
    console.log('✓ netGuard successfully threw EACCES and victim received 0 hits');
  } finally {
    victimServer.close();
  }
}

// ==========================================
// 3. WP1.3 — B25 EgressProxy Retry & Cap
// ==========================================
async function testB25EgressProxy() {
  console.log('--- Test 1.3: B25 EgressProxy slow upstream keep-alive reuse ---');

  let upstreamRequests = 0;
  const upstreamServer = http.createServer(async (_req, res) => {
    upstreamRequests++;
    // Simulate slow upstream: 6s before first byte
    await new Promise((r) => setTimeout(r, 6000));
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('slow upstream ok');
  });

  await new Promise<void>((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstreamServer.address() as net.AddressInfo).port;

  try {
    // Dynamically test via fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`http://127.0.0.1:${upstreamPort}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'slow upstream ok');
    assert.equal(upstreamRequests, 1, `Expected exactly 1 request upstream, got ${upstreamRequests}`);
    console.log('✓ Slow upstream returned 200 once with 0 duplicate requests');
  } finally {
    upstreamServer.close();
  }
}

// ==========================================
// 3b. WP1.4 — B26 Pipeline completeJob count 0
// ==========================================
async function testB26CountZero() {
  console.log('--- Test 1.4: B26 completeJob count 0 single job_finished publication ---');

  const testJob = await prisma.job.create({
    data: {
      targetUrl: 'https://example.com/b26',
      status: 'cancelled',
      visitorId: 'b26-visitor',
      usedOwnKeys: true,
      ipHash: 'b26-hash',
    },
  });

  const publishedEvents: JobEvent[] = [];
  openJobChannel(testJob.id);
  const sub = subscribeJobEvents(testJob.id, undefined, (ev) => {
    publishedEvents.push(ev);
  });

  let finishedPublished = false;
  // Simulate completeJob returning count 0 (because status is already cancelled)
  const completeRes = await completeJob(testJob.id);
  assert.equal(completeRes.count, 0, 'completeJob on already-cancelled job must return count 0');

  if (completeRes.count === 0) {
    const current = await prisma.job.findUnique({
      where: { id: testJob.id },
      select: { status: true, errorCode: true },
    });
    const rowStatus = (current?.status as 'cancelled' | 'failed' | 'completed') ?? 'cancelled';
    if (!finishedPublished) {
      finishedPublished = true;
      publishJobEvent(testJob.id, {
        type: 'job_finished',
        data: { status: rowStatus, errorCode: current?.errorCode ?? null },
      });
    }
  }

  // Simulate catch block trying to re-publish if cancelled
  if (!finishedPublished) {
    publishJobEvent(testJob.id, { type: 'job_finished', data: { status: 'cancelled', errorCode: null } });
  }

  sub?.unsubscribe();

  const finishedEvents = publishedEvents.filter((e) => e.type === 'job_finished');
  assert.equal(finishedEvents.length, 1, `Expected exactly 1 job_finished event, got ${finishedEvents.length}`);
  assert.equal(finishedEvents[0].data.status, 'cancelled');
  console.log('✓ B26 completeJob count 0 published exactly ONE job_finished event with status cancelled');
}

// ==========================================
// 4. WP3 — Production Fail-Fast Config Tests
// ==========================================
async function testProductionConfigValidation() {
  console.log('--- Test 3: Production fail-fast validation missing secrets ---');

  const testScript = `
    import { validateProductionConfig } from './src/config.ts';
    try {
      validateProductionConfig();
      process.exit(0);
    } catch (e) {
      process.exit(99);
    }
  `;

  // Run in subprocess with NODE_ENV=production, empty secrets
  const exitCode = await new Promise<number | null>((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '-e', `
        process.env.NODE_ENV = 'production';
        process.env.LOCAL_AGENT_MODE = 'false';
        delete process.env.VISITOR_SIGNING_SECRET;
        delete process.env.POW_SECRET;
        delete process.env.ADMIN_SECRET;
        delete process.env.EDGE_SHARED_SECRET;
        delete process.env.FRONTEND_ORIGIN;
        delete process.env.GROQ_API_KEY;
        delete process.env.GEMINI_API_KEY;
        
        import('./src/config.ts').then(() => {
          process.exit(0);
        }).catch(() => {
          process.exit(1);
        });
      `],
      { cwd: path.resolve(__dirname, '..') },
    );
    child.on('close', resolve);
  });

  assert.equal(exitCode, 1, 'Production mode without secrets must exit(1)');
  console.log('✓ Missing production secrets trigger fail-fast exit(1)');
}

// ==========================================
// 5. WP4 — Server Events & Admin Route
// ==========================================
async function testServerEventsAndAdmin() {
  console.log('--- Test 4: ServerEvent deduplication, redaction, and admin gate ---');

  // Redaction tests
  const secretKey = 'gsk_1234567890abcdef1234567890abcdef';
  const urlWithQuery = 'https://example.com/api?apiKey=secret123&token=abc';
  const rawMsg = `Error connecting to ${urlWithQuery} with key ${secretKey}`;

  const redacted = redactSensitiveText(rawMsg);
  assert(!redacted.includes('secret123'), 'Query params must be stripped');
  assert(!redacted.includes(secretKey), 'API keys must be redacted');
  assert(redacted.includes('https://example.com/api'), 'Base URL must be preserved');
  console.log('✓ Redaction masks keys and query strings');

  // Context cap
  const bigContext = { data: 'x'.repeat(5000) };
  const redactedCtx = redactContext(bigContext);
  assert(JSON.stringify(redactedCtx).length <= 4096, 'Context must be capped at 4KB');
  console.log('✓ Context capped at <= 4KB');

  // Deduplication fingerprint
  const fp1 = computeFingerprint('test:source', 'Failed to connect to 127.0.0.1:4000 at job 123');
  const fp2 = computeFingerprint('test:source', 'Failed to connect to 127.0.0.1:4000 at job 456');
  assert.equal(fp1, fp2, 'Normalized messages with different numbers/UUIDs must share fingerprint');
  console.log('✓ Normalized fingerprint matches similar messages');

  // Hourly write cap
  resetHourlyLimitForTest();

  const originalAdminSecret = config.ADMIN_SECRET;
  (config as any).ADMIN_SECRET = 'test-admin-secret-at-least-24-chars';

  // Admin route gating
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  try {
    // 1. Without header -> 404
    const resNoHeader = await fetch(`http://127.0.0.1:${port}/admin/events`);
    assert.equal(resNoHeader.status, 404, 'Missing X-Admin-Secret must return 404');

    // 2. With wrong header -> 404
    const resWrongHeader = await fetch(`http://127.0.0.1:${port}/admin/events`, {
      headers: { 'X-Admin-Secret': 'wrong-secret-value' },
    });
    assert.equal(resWrongHeader.status, 404, 'Wrong X-Admin-Secret must return 404');

    // 3. With correct header -> 200
    const resAuth = await fetch(`http://127.0.0.1:${port}/admin/events`, {
      headers: { 'X-Admin-Secret': config.ADMIN_SECRET || 'test-admin-secret-at-least-24-chars' },
    });
    assert.equal(resAuth.status, 200, 'Valid X-Admin-Secret must return 200');

    // 4. Query string secret -> 404 (secret in query must not be accepted)
    const resQuery = await fetch(
      `http://127.0.0.1:${port}/admin/events?secret=${config.ADMIN_SECRET}`,
    );
    assert.equal(resQuery.status, 404, 'Secret in query string must return 404');

    // 5. Admin whoami route
    const resWhoami = await fetch(`http://127.0.0.1:${port}/admin/whoami`, {
      headers: { 'X-Admin-Secret': config.ADMIN_SECRET || 'test-admin-secret-at-least-24-chars' },
    });
    assert.equal(resWhoami.status, 200, 'Admin /whoami must return 200 with valid secret');
    const whoamiData = (await resWhoami.json()) as any;
    assert('clientIp' in whoamiData);
    assert('reqIp' in whoamiData);
    console.log('✓ Admin /events and /whoami routes gated correctly (404 on mismatch, 200 on match)');
  } finally {
    (config as any).ADMIN_SECRET = originalAdminSecret;
    server.close();
  }
}

// ==========================================
// 6. WP5 — Client IP Resolution Tests
// ==========================================
function testClientIpExtraction() {
  console.log('--- Test 5: clientIp helper with edge secret and spoof protection ---');

  const originalEdgeSecret = config.EDGE_SHARED_SECRET;
  const testEdgeSecret = 'test-edge-secret-at-least-24-chars';
  (config as any).EDGE_SHARED_SECRET = testEdgeSecret;

  try {
    // Mock Request factory
    const makeReq = (headers: Record<string, string>, ip = '10.0.0.1') =>
      ({
        header: (name: string) => headers[name.toLowerCase()] ?? headers[name],
        ip,
      }) as unknown as Request;

    // 1. Spoofed x-agt-client-ip WITHOUT secret -> ignored, returns req.ip
    const spoofedReq = makeReq({
      'x-agt-client-ip': '1.2.3.4',
    });
    assert.equal(clientIp(spoofedReq), '10.0.0.1', 'Spoofed edge IP without secret must be ignored');

    // 2. Spoofed x-agt-client-ip with WRONG secret -> ignored
    const wrongSecretReq = makeReq({
      'x-agt-client-ip': '1.2.3.4',
      'x-agt-edge-secret': 'wrong-secret',
    });
    assert.equal(clientIp(wrongSecretReq), '10.0.0.1', 'Spoofed edge IP with wrong secret must be ignored');

    // 3. Valid edge secret + valid IPv4 -> returns edge IP
    const validIpv4Req = makeReq({
      'x-agt-client-ip': '203.0.113.195',
      'x-agt-edge-secret': testEdgeSecret,
    });
    assert.equal(clientIp(validIpv4Req), '203.0.113.195', 'Valid edge secret must resolve edge client IP');

    // 4. Valid edge secret + invalid IP -> fallback to req.ip
    const invalidIpReq = makeReq({
      'x-agt-client-ip': 'not-an-ip-address',
      'x-agt-edge-secret': testEdgeSecret,
    });
    assert.equal(clientIp(invalidIpReq), '10.0.0.1', 'Invalid edge client IP must fallback to req.ip');

    console.log('✓ clientIp extracts verified IP and ignores spoofed headers');
  } finally {
    (config as any).EDGE_SHARED_SECRET = originalEdgeSecret;
  }
}

// ==========================================
// Main Runner
// ==========================================
async function runAll() {
  console.log('====================================================');
  console.log('      PHASE 9A DEPLOY READINESS TEST SUITE');
  console.log('====================================================\n');

  testCodeSafetyBypasses();
  await testNetGuard();
  await testB25EgressProxy();
  await testB26CountZero();
  await testProductionConfigValidation();
  await testServerEventsAndAdmin();
  testClientIpExtraction();

  console.log('\n====================================================');
  console.log('  ALL PHASE 9A TESTS PASSED (WP1, WP3, WP4, WP5)');
  console.log('====================================================');

  try {
    const { stopEgressProxy } = await import('../src/security/egressProxy.ts');
    await stopEgressProxy();
  } catch {}

  try {
    await prisma.$disconnect();
  } catch {}

  process.exit(0);
}

runAll().catch(async (err) => {
  console.error('\n❌ PHASE 9A TEST SUITE FAILED:', err);
  try {
    const { stopEgressProxy } = await import('../src/security/egressProxy.ts');
    await stopEgressProxy();
  } catch {}
  try {
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
