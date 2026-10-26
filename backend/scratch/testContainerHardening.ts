// Mock minimal environment for tests before any imports
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
process.env.DIRECT_URL = 'postgresql://user:pass@localhost:5432/db';
process.env.LOCAL_AGENT_MODE = 'true';

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fsSync from 'node:fs';
import { randomUUID } from 'node:crypto';
import { HeavyOpGate, QueueFullError, heavyOpGate } from '../src/security/concurrencyGate.ts';
import { crawlPage } from '../src/crawler/pageCrawler.ts';
import { observeAppMap } from '../src/crawler/observe.ts';
import { executeTests } from '../src/runner/executor.ts';
import { executeChunkedBatch } from '../src/agent/pipeline.ts';
import { traceForAttempt } from '../src/runner/traceStore.ts';
import { childProcessEnv, playwrightRunnerEnv } from '../src/runner/childEnv.ts';
import { findUnsafeConstructs } from '../src/runner/codeSafety.ts';

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
  // ──────────────────────────────────────────────────────────
  // H1: HeavyOpGate maxActive, priority ordering, maxWaiting, timeout, abort
  // ──────────────────────────────────────────────────────────
  await run('H1 HeavyOpGate mechanics', async () => {
    const gate = new HeavyOpGate(1);
    assert.equal(gate.activeCount, 0);

    // 1. acquirePipeline slot 1
    const rel1 = await gate.acquirePipeline();
    assert.equal(gate.activeCount, 1);

    // 2. Queue preview waiter and pipeline waiter
    let previewWoken = false;
    let pipelineWoken = false;

    const previewPromise = gate.acquirePreview({ timeoutMs: 5000 }).then((rel) => {
      previewWoken = true;
      rel();
    });

    const pipelinePromise = gate.acquirePipeline({ timeoutMs: 5000 }).then((rel) => {
      pipelineWoken = true;
      rel();
    });

    assert.equal(gate.pipelineWaitingCount, 1);
    assert.equal(gate.previewWaitingCount, 1);

    // Release slot 1: pipeline waiter must wake before preview waiter
    rel1();

    await pipelinePromise;
    assert.equal(pipelineWoken, true);

    await previewPromise;
    assert.equal(previewWoken, true);
    assert.equal(gate.activeCount, 0);

    // 3. maxWaiting cap on preview
    const relHold = await gate.acquirePipeline();
    const p1 = gate.acquirePreview({ timeoutMs: 5000, maxWaiting: 3 });
    const p2 = gate.acquirePreview({ timeoutMs: 5000, maxWaiting: 3 });
    const p3 = gate.acquirePreview({ timeoutMs: 5000, maxWaiting: 3 });
    assert.equal(gate.previewWaitingCount, 3);

    // 4th concurrent waiter must reject immediately with QueueFullError
    await assert.rejects(
      async () => {
        await gate.acquirePreview({ timeoutMs: 5000, maxWaiting: 3 });
      },
      (err) => err instanceof QueueFullError,
    );

    // Drain p1, p2, p3 before testing timeout
    relHold();
    const r1 = await p1;
    r1();
    const r2 = await p2;
    r2();
    const r3 = await p3;
    r3();
    assert.equal(gate.activeCount, 0);

    // 4. Timeout on preview waiter
    const holdForTimeout = await gate.acquirePipeline();
    await assert.rejects(
      async () => {
        await gate.acquirePreview({ timeoutMs: 60, maxWaiting: 3 });
      },
      (err) => err instanceof QueueFullError,
    );
    holdForTimeout();
    assert.equal(gate.activeCount, 0);

    // 5. AbortSignal cleanup
    const holdAgain = await gate.acquirePipeline();

    const acPipe = new AbortController();
    const pipeAbortPromise = gate.acquirePipeline({ signal: acPipe.signal });
    assert.equal(gate.pipelineWaitingCount, 1);
    acPipe.abort(new Error('Pipe aborted'));
    await assert.rejects(pipeAbortPromise, /Pipe aborted/);
    assert.equal(gate.pipelineWaitingCount, 0);

    const acPrev = new AbortController();
    const prevAbortPromise = gate.acquirePreview({ signal: acPrev.signal });
    assert.equal(gate.previewWaitingCount, 1);
    acPrev.abort(new Error('Prev aborted'));
    await assert.rejects(prevAbortPromise, /Prev aborted/);
    assert.equal(gate.previewWaitingCount, 0);

    holdAgain();
    assert.equal(gate.activeCount, 0);
    pass('H1 HeavyOpGate mechanics');
  });

  // ──────────────────────────────────────────────────────────
  // H2: Stage-scoped resource blocking preserves CSS visibility & blocks image/media/font
  // ──────────────────────────────────────────────────────────
  await run('H2 Resource filter & CSS preservation', async () => {
    let styleServed = 0;
    let heroServed = 0;
    let promoServed = 0;
    let fontServed = 0;

    const server = http.createServer((req, res) => {
      const u = req.url || '/';
      if (u === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="hidden-drawer"><button id="drawer-btn">Secret Drawer Action</button></div>
  <div class="custom-card" id="card-el">Card Action</div>
  <img id="hero" src="/hero.png" alt="Brand" style="width:40px;height:40px" />
  <video src="/promo.mp4"></video>
</body>
</html>`);
        return;
      }
      if (u === '/style.css') {
        styleServed++;
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(`
@font-face {
  font-family: 'BrandFont';
  src: url('/brand.woff2') format('woff2');
}
#hidden-drawer { display: none; }
.custom-card { cursor: pointer; width: 120px; height: 36px; font-family: 'BrandFont', sans-serif; }
`);
        return;
      }
      if (u === '/hero.png') {
        heroServed++;
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return;
      }
      if (u === '/promo.mp4') {
        promoServed++;
        res.writeHead(200, { 'Content-Type': 'video/mp4' });
        res.end(Buffer.from([0x00, 0x00, 0x00, 0x20]));
        return;
      }
      if (u === '/brand.woff2') {
        fontServed++;
        res.writeHead(200, { 'Content-Type': 'font/woff2' });
        res.end(Buffer.from([0x77, 0x4f, 0x46, 0x32]));
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const serverUrl = `http://127.0.0.1:${port}/`;

    try {
      const appMap = await crawlPage(serverUrl);
      assert.ok(styleServed >= 1, 'style.css was served');
      assert.equal(heroServed, 0, 'hero.png was blocked (0 hits)');
      assert.equal(promoServed, 0, 'promo.mp4 was blocked (0 hits)');
      assert.equal(fontServed, 0, 'brand.woff2 was blocked (0 hits)');

      const drawerBtn = appMap.elements.find((e) => e.text?.includes('Secret Drawer Action'));
      assert.ok(drawerBtn, 'found drawerBtn');
      assert.equal(drawerBtn.isVisible, false, 'hidden-drawer button isVisible is false');

      const cardEl = appMap.elements.find((e) => e.text?.includes('Card Action'));
      assert.ok(cardEl, 'found cardEl');
      assert.equal(cardEl.isVisible, true, 'cardEl isVisible is true');
      assert.equal(cardEl.detectedBy, 'cursor-pointer', 'cardEl detected by cursor-pointer');

      // Test execution: verify execution does NOT block resources
      const execResult = await executeTests(
        `test-h2-${Date.now()}`,
        [
          {
            filename: 'tc-h2.spec.ts',
            code: `
import { test, expect } from '@playwright/test';
test('tc-h2 loads hero', async ({ page }) => {
  await page.goto('${serverUrl}');
  await expect(page.locator('#hero')).toBeAttached();
});
`,
          },
        ],
        { timeoutMs: 30_000 },
      );

      assert.equal(execResult.success, true, 'execution succeeded');
      assert.ok(heroServed >= 1, 'hero.png was loaded during executeTests');
      pass('H2 Resource filter & CSS preservation');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // ──────────────────────────────────────────────────────────
  // H3: Hard Observe deadline abort
  // ──────────────────────────────────────────────────────────
  await run('H3 Hard Observe deadline abort', async () => {
    const server = http.createServer((req, res) => {
      const u = req.url || '/';
      if (u === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><body><a href="/slow-hang">Slow Link</a></body></html>`);
        return;
      }
      if (u === '/slow-hang') {
        // Intentionally hang response for 10s
        setTimeout(() => {
          try {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Slow</h1>');
          } catch {}
        }, 10_000);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    const serverUrl = `http://127.0.0.1:${port}/`;

    try {
      const appMap = await crawlPage(serverUrl);
      const startObs = Date.now();
      const observations = await observeAppMap(appMap, { deadlineMs: 700 });
      const elapsed = Date.now() - startObs;

      assert.ok(elapsed < 4_000, `Observe duration was ${elapsed}ms (< 4000ms)`);
      assert.equal(heavyOpGate.activeCount, 0, 'heavyOpGate.activeCount is 0 after observe timeout');
      pass('H3 Hard Observe deadline abort');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // ──────────────────────────────────────────────────────────
  // H4: executeChunkedBatch 3-spec chunking + trace harvest
  // ──────────────────────────────────────────────────────────
  await run('H4 executeChunkedBatch chunking and trace harvest', async () => {
    const runId = `test-h4-${Date.now()}`;
    const jobId = randomUUID();
    const validFiles = [
      {
        filename: 'tc-1.spec.ts',
        code: `import { test, expect } from '@playwright/test'; test('tc-1', async ({ page }) => { expect(1).toBe(1); });`,
      },
      {
        filename: 'tc-2.spec.ts',
        code: `import { test, expect } from '@playwright/test'; test('tc-2', async ({ page }) => { expect(2).toBe(2); });`,
      },
      {
        filename: 'tc-3.spec.ts',
        code: `import { test, expect } from '@playwright/test'; test('tc-3', async ({ page }) => { expect(3).toBe(3); });`,
      },
      {
        filename: 'tc-4.spec.ts',
        code: `import { test, expect } from '@playwright/test'; test('tc-4', async ({ page }) => { expect(1).toBe(2); });`,
      },
    ];

    const executionMeta = validFiles.map((f) => ({
      filename: f.filename,
      testCaseId: f.filename.replace(/\.spec\.ts$/, ''),
      attemptNumber: 1,
    }));

    const capturedTraces = new Map<string, string>();
    const res = await executeChunkedBatch(runId, validFiles, {
      chunkSize: 3,
      trace: true,
      jobId,
      traceOwnerId: '',
      executionMeta,
      onTraceZips: async (traces) => {
        for (const [k, v] of traces.entries()) {
          assert.equal(fsSync.existsSync(v), true, `Trace zip file should exist at ${v}`);
          capturedTraces.set(k, v);
        }
      },
    });

    assert.equal(res.results.length, 4, 'all 4 test cases produced results');
    const tc1 = res.results.find((r) => r.testCaseId === 'tc-1');
    const tc2 = res.results.find((r) => r.testCaseId === 'tc-2');
    const tc3 = res.results.find((r) => r.testCaseId === 'tc-3');
    const tc4 = res.results.find((r) => r.testCaseId === 'tc-4');

    assert.equal(tc1?.passed, true);
    assert.equal(tc2?.passed, true);
    assert.equal(tc3?.passed, true);
    assert.equal(tc4?.passed, false);
    assert.equal(res.success, false);

    assert.equal(capturedTraces.size, 4, 'all 4 traces captured in onTraceZips');
    for (const id of ['tc-1', 'tc-2', 'tc-3', 'tc-4']) {
      const trace = traceForAttempt(jobId, id, 1, '');
      assert.ok(trace !== null, `traceForAttempt for ${id} should not be null`);
      assert.ok(trace.sizeBytes > 0, `trace size for ${id} should be > 0`);
    }

    assert.equal(heavyOpGate.activeCount, 0, 'heavyOpGate.activeCount is 0 after chunked execution');
    pass('H4 executeChunkedBatch chunking and trace harvest');
  });

  // ──────────────────────────────────────────────────────────
  // H5: childEnv & synchronous lazy findUnsafeConstructs
  // ──────────────────────────────────────────────────────────
  await run('H5 childEnv & lazy findUnsafeConstructs', async () => {
    const env = playwrightRunnerEnv('/tmp/test-results.json');
    assert.equal(env.MALLOC_ARENA_MAX, '2');
    assert.equal(env.UV_THREADPOOL_SIZE, '2');
    assert.ok(env.NODE_OPTIONS?.includes('--max-old-space-size=112'));

    // Verify secrets are stripped
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.DIRECT_URL, undefined);
    assert.equal(env.GROQ_API_KEY, undefined);
    assert.equal(env.GEMINI_API_KEY, undefined);

    // Synchronous findUnsafeConstructs check
    const safeCode = `import { test, expect } from '@playwright/test'; test('ok', async ({ page }) => { expect(1).toBe(1); });`;
    const safeErrors = findUnsafeConstructs(safeCode);
    assert.deepEqual(safeErrors, []);

    const processCode = `import { test, expect } from '@playwright/test'; test('bad', async () => { console.log(process.env.SECRET); });`;
    const processErrors = findUnsafeConstructs(processCode);
    assert.ok(processErrors.length > 0, 'detected process.env');

    const fetchCode = `import { test, expect } from '@playwright/test'; test('bad', async () => { fetch('https://evil.com'); });`;
    const fetchErrors = findUnsafeConstructs(fetchCode);
    assert.ok(fetchErrors.length > 0, 'detected fetch');

    pass('H5 childEnv & lazy findUnsafeConstructs');
  });

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} test(s) failed`);
    process.exit(1);
  } else {
    console.log('\nALL TESTS PASSED');
  }
}

main().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
