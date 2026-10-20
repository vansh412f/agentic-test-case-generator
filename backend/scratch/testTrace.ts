import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  initTraceStore,
  registerTrace,
  getTrace,
  traceForAttempt,
  signTraceToken,
  verifyTraceToken,
} from '../src/runner/traceStore.ts';
import { executeTests } from '../src/runner/executor.ts';

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
  await initTraceStore();

  const tempFiles: string[] = [];
  let t1TraceId = '';

  try {
    // T1: register/get round-trip
    await run('T1 register/get round-trip', async () => {
      const dummyPath = path.join(os.tmpdir(), `trace-test-${randomUUID()}.zip`);
      tempFiles.push(dummyPath);
      await fs.writeFile(dummyPath, Buffer.alloc(100, 0x41)); // 100 bytes > 16 bytes

      const jobId = 'trace-test-job';
      const visitorId = 'trace-test-visitor';
      const testCaseId = 'tc-1';
      const attemptNumber = 1;

      const traceId = await registerTrace(dummyPath, {
        jobId,
        testCaseId,
        attemptNumber,
        visitorId,
      });

      assert.ok(traceId, 'registerTrace must return a traceId');
      t1TraceId = traceId;

      const found = getTrace(traceId);
      assert.ok(found, 'getTrace must return entry');
      assert.equal(found.entry.sizeBytes, 100, 'sizeBytes must match');
      assert.ok(fsSync.existsSync(found.filePath), 'filePath must exist on disk');

      pass('T1 register/get round-trip');
    });

    // T2: token security
    await run('T2 token security', async () => {
      assert.ok(t1TraceId, 't1TraceId must exist');
      const visitorId = 'trace-test-visitor';

      const token = signTraceToken(t1TraceId, visitorId);
      assert.equal(verifyTraceToken(t1TraceId, token), true, 'valid token must verify');

      // Last char flipped -> false
      const lastChar = token.slice(-1);
      const flippedChar = lastChar === 'a' ? 'b' : 'a';
      const tampered = token.slice(0, -1) + flippedChar;
      assert.equal(verifyTraceToken(t1TraceId, tampered), false, 'tampered signature must fail');

      // Token for T1's id verified against a different random uuid -> false
      const randomId = randomUUID();
      assert.equal(verifyTraceToken(randomId, token), false, 'token with different traceId must fail');

      // signTraceToken with negative ttl (already expired) -> false
      const expiredToken = signTraceToken(t1TraceId, visitorId, -1000);
      assert.equal(verifyTraceToken(t1TraceId, expiredToken), false, 'expired token must fail');

      pass('T2 token security');
    });

    // T3: owner gating
    await run('T3 owner gating', async () => {
      const jobId = 'trace-test-job';
      const visitorId = 'trace-test-visitor';
      const testCaseId = 'tc-1';
      const attemptNumber = 1;

      assert.equal(
        traceForAttempt(jobId, testCaseId, attemptNumber, 'someone-else'),
        null,
        'traceForAttempt for someone-else must be null',
      );

      const entry = traceForAttempt(jobId, testCaseId, attemptNumber, visitorId);
      assert.ok(entry, 'traceForAttempt for owner must return entry');
      assert.equal(entry.traceId, t1TraceId, 'entry traceId must match');

      assert.equal(
        traceForAttempt(jobId, testCaseId, 999, visitorId),
        null,
        'wrong attemptNumber must return null',
      );

      pass('T3 owner gating');
    });

    // T4: oversize rejection
    await run('T4 oversize rejection', async () => {
      const largePath = path.join(os.tmpdir(), `trace-large-${randomUUID()}.zip`);
      tempFiles.push(largePath);

      const fh = await fs.open(largePath, 'w');
      await fh.truncate(26 * 1024 * 1024); // 26MB > 25MB
      await fh.close();

      const largeTraceId = await registerTrace(largePath, {
        jobId: 'trace-oversize-job',
        testCaseId: 'tc-large',
        attemptNumber: 1,
        visitorId: 'trace-test-visitor',
      });

      assert.equal(largeTraceId, null, 'oversize file must return null');
      pass('T4 oversize rejection');
    });

    // T6: LIVE only when env TRACE_LIVE=1
    if (process.env.TRACE_LIVE !== '1') {
      console.log('[SKIP] T6 live trace capture (set TRACE_LIVE=1 to run)');
    } else {
      await run('T6 live trace capture', async () => {
        const liveSpec = [
          "import { test, expect } from '@playwright/test';",
          '',
          "test('example.com title', async ({ page }) => {",
          "  await page.goto('https://example.com');",
          "  await expect(page).toHaveTitle(/Example/);",
          "  await page.screenshot();",
          '});',
          '',
        ].join('\n');

        let onTraceZipCalled = false;
        // Run once WITHOUT trace
        await executeTests(
          `t6-notrace-${randomUUID().slice(0, 8)}`,
          [{ filename: 'test.spec.ts', code: liveSpec }],
          {
            trace: false,
            onTraceZip: async () => {
              onTraceZipCalled = true;
            },
          },
        );
        assert.equal(onTraceZipCalled, false, 'onTraceZip must not be called when trace is false');

        // Run once WITH trace: true + onTraceZip
        let capturedTraceId: string | null = null;
        await executeTests(
          `t6-trace-${randomUUID().slice(0, 8)}`,
          [{ filename: 'test.spec.ts', code: liveSpec }],
          {
            trace: true,
            onTraceZip: async (zipPath) => {
              capturedTraceId = await registerTrace(zipPath, {
                jobId: 't6-live-job',
                testCaseId: 't6-live-tc',
                attemptNumber: 1,
                visitorId: 't6-live-visitor',
              });
            },
          },
        );

        assert.ok(capturedTraceId, 'capturedTraceId must be present');
        const foundTrace = getTrace(capturedTraceId);
        assert.ok(foundTrace, 'getTrace must return entry');
        assert.ok(
          foundTrace.entry.sizeBytes > 10 * 1024,
          `trace zip size must be > 10KB, got ${foundTrace.entry.sizeBytes}`,
        );

        const headerBuf = Buffer.alloc(4);
        const traceFh = await fs.open(foundTrace.filePath, 'r');
        await traceFh.read(headerBuf, 0, 4, 0);
        await traceFh.close();

        // 50 4B 03 04 ("PK\x03\x04")
        assert.equal(headerBuf[0], 0x50, 'magic byte 0 must be 0x50');
        assert.equal(headerBuf[1], 0x4b, 'magic byte 1 must be 0x4b');
        assert.equal(headerBuf[2], 0x03, 'magic byte 2 must be 0x03');
        assert.equal(headerBuf[3], 0x04, 'magic byte 3 must be 0x04');

        pass('T6 live trace capture');
      });
    }
  } finally {
    for (const f of tempFiles) {
      try {
        await fs.unlink(f);
      } catch {
        // ignore
      }
    }
  }

  if (failures > 0) {
    console.error(`\n=== ${failures} TRACE TEST(S) FAILED ===`);
    process.exitCode = 1;
  } else {
    console.log('\n=== ALL TRACE TESTS PASSED ===');
  }
}

main().catch((err) => {
  console.error('testTrace crashed:', err);
  process.exitCode = 1;
});
