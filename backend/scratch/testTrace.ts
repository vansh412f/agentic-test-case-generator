// Mock minimal environment for tests
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
process.env.DIRECT_URL = 'postgresql://user:pass@localhost:5432/db';

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
  planEvictions,
  MAX_TRACES,
  MAX_TOTAL_TRACE_BYTES,
  TraceEntry,
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

    // T5: duplicate registration replaces old entry and file
    await run('T5 duplicate-replace registration', async () => {
      const p1 = path.join(os.tmpdir(), `trace-dup1-${randomUUID()}.zip`);
      const p2 = path.join(os.tmpdir(), `trace-dup2-${randomUUID()}.zip`);
      tempFiles.push(p1, p2);

      await fs.writeFile(p1, Buffer.alloc(120, 0x42));
      await fs.writeFile(p2, Buffer.alloc(240, 0x43));

      const meta = {
        jobId: 'trace-dup-job',
        testCaseId: 'tc-dup',
        attemptNumber: 1,
        visitorId: 'trace-dup-visitor',
      };

      const traceId1 = await registerTrace(p1, meta);
      assert.ok(traceId1, 'first registration must succeed');
      const found1 = getTrace(traceId1);
      assert.ok(found1, 'found1 must exist');
      assert.equal(found1.entry.sizeBytes, 120);
      const file1Path = found1.filePath;
      assert.ok(fsSync.existsSync(file1Path), 'file1 must exist on disk');

      // Register same meta with p2
      const traceId2 = await registerTrace(p2, meta);
      assert.ok(traceId2, 'second registration must succeed');
      assert.notEqual(traceId1, traceId2, 'new traceId should be generated');

      // Old trace should be evicted/deleted
      assert.equal(getTrace(traceId1), null, 'old traceId1 must be gone from registry');
      assert.equal(fsSync.existsSync(file1Path), false, 'old file1 must be deleted from disk');

      // New trace should be active with new size
      const found2 = getTrace(traceId2);
      assert.ok(found2, 'found2 must exist');
      assert.equal(found2.entry.sizeBytes, 240);
      assert.ok(fsSync.existsSync(found2.filePath), 'file2 must exist on disk');

      // traceForAttempt should return the new entry
      const current = traceForAttempt(meta.jobId, meta.testCaseId, meta.attemptNumber, meta.visitorId);
      assert.ok(current, 'current attempt trace must exist');
      assert.equal(current.traceId, traceId2, 'current trace must be the new one');

      pass('T5 duplicate-replace registration');
    });

    // T6: LIVE only when env TRACE_LIVE=1
    if (process.env.TRACE_LIVE !== '1') {
      console.log('[SKIP] T6 & T7 live trace capture (set TRACE_LIVE=1 to run)');
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

      // T7: live two-file onTraceZips mapping case
      await run('T7 live two-file onTraceZips mapping', async () => {
        const spec1 = [
          "import { test, expect } from '@playwright/test';",
          "test('tc-1 title check', async ({ page }) => {",
          "  await page.goto('https://example.com');",
          "  await expect(page).toHaveTitle(/Example/);",
          '});',
        ].join('\n');
        const spec2 = [
          "import { test, expect } from '@playwright/test';",
          "test('tc-2 heading check', async ({ page }) => {",
          "  await page.goto('https://example.com');",
          "  await expect(page.locator('h1')).toHaveText(/Example Domain/);",
          '});',
        ].join('\n');

        const harvestedTraces = new Map<string, string>();
        const registeredIds = new Map<string, string>();
        const traceSizes = new Map<string, number>();

        await executeTests(
          `t7-multitrace-${randomUUID().slice(0, 8)}`,
          [
            { filename: 'tc-1.spec.ts', code: spec1 },
            { filename: 'tc-2.spec.ts', code: spec2 },
          ],
          {
            trace: true,
            onTraceZips: async (traces) => {
              for (const [key, val] of traces.entries()) {
                harvestedTraces.set(key, val);
                const stat = await fs.stat(val);
                traceSizes.set(key, stat.size);

                // Verify magic bytes on the live harvest file before cleanup
                const headerBuf = Buffer.alloc(4);
                const fh = await fs.open(val, 'r');
                await fh.read(headerBuf, 0, 4, 0);
                await fh.close();
                assert.equal(headerBuf[0], 0x50, 'magic byte 0 must be 0x50');
                assert.equal(headerBuf[1], 0x4b, 'magic byte 1 must be 0x4b');
                assert.equal(headerBuf[2], 0x03, 'magic byte 2 must be 0x03');
                assert.equal(headerBuf[3], 0x04, 'magic byte 3 must be 0x04');

                // Register into traceStore as pipeline does
                const regId = await registerTrace(val, {
                  jobId: 't7-multitrace-job',
                  testCaseId: key,
                  attemptNumber: 1,
                  visitorId: 't7-multitrace-visitor',
                });
                if (regId) {
                  registeredIds.set(key, regId);
                }
              }
            },
          },
        );

        assert.ok(harvestedTraces.has('tc-1'), 'must have trace for tc-1');
        assert.ok(harvestedTraces.has('tc-2'), 'must have trace for tc-2');

        const size1 = traceSizes.get('tc-1') ?? 0;
        const size2 = traceSizes.get('tc-2') ?? 0;
        console.log(`[Evidence] tc-1 trace size: ${size1} bytes, tc-2 trace size: ${size2} bytes`);
        assert.ok(size1 > 5 * 1024, `tc-1 zip size must be > 5KB, got ${size1}`);
        assert.ok(size2 > 5 * 1024, `tc-2 zip size must be > 5KB, got ${size2}`);

        // Verify traces persisted in traceStore
        const trace1 = getTrace(registeredIds.get('tc-1')!);
        const trace2 = getTrace(registeredIds.get('tc-2')!);
        assert.ok(trace1, 'trace1 must exist in traceStore');
        assert.ok(trace2, 'trace2 must exist in traceStore');
        assert.equal(trace1.entry.sizeBytes, size1);
        assert.equal(trace2.entry.sizeBytes, size2);

        pass('T7 live two-file onTraceZips mapping');
      });
    }

    // T8: FIFO/count + byte eviction planning
    await run('T8 FIFO/count + byte eviction planning', async () => {
      // 1. Count-cap FIFO eviction (200 entries + 1 incoming -> evict oldest)
      const synthetic200: TraceEntry[] = [];
      for (let i = 0; i < MAX_TRACES; i++) {
        synthetic200.push({
          jobId: `job-${i}`,
          testCaseId: `tc-${i}`,
          attemptNumber: 1,
          visitorId: 'v1',
          createdAt: 1000 + i,
          expiresAt: 1000 + i + 3600000,
          sizeBytes: 1024,
          traceId: `trace-count-${i}`,
        });
      }

      const evictedCount = planEvictions(synthetic200, 1024);
      assert.equal(evictedCount.length, 1, 'must evict exactly 1 entry when count reaches MAX_TRACES');
      assert.equal(evictedCount[0], 'trace-count-0', 'must evict the oldest entry by createdAt');

      // 2. Byte-ceiling eviction: enough entries evicted for large incoming trace
      const syntheticBytes: TraceEntry[] = [];
      const mib = 1024 * 1024;
      for (let i = 0; i < 10; i++) {
        syntheticBytes.push({
          jobId: `job-byte-${i}`,
          testCaseId: `tc-byte-${i}`,
          attemptNumber: 1,
          visitorId: 'v1',
          createdAt: 2000 + i,
          expiresAt: 2000 + i + 3600000,
          sizeBytes: 25 * mib,
          traceId: `trace-byte-${i}`,
        });
      }

      // Incoming 20 MiB requires 14 MiB freed -> evicts oldest 1 entry (25 MiB)
      const evictedFor20 = planEvictions(syntheticBytes, 20 * mib);
      assert.equal(evictedFor20.length, 1, 'must evict 1 entry to satisfy byte ceiling');
      assert.equal(evictedFor20[0], 'trace-byte-0', 'must evict the oldest entry first');

      // Incoming 20 MiB with multiple smaller entries:
      // 25 entries of 10 MiB = 250 MiB. Incoming 20 MiB -> 250 - X + 20 <= 256 -> X >= 14 MiB -> 2 entries evicted (20 MiB freed)
      const syntheticMulti: TraceEntry[] = [];
      for (let i = 0; i < 25; i++) {
        syntheticMulti.push({
          jobId: `job-multi-${i}`,
          testCaseId: `tc-multi-${i}`,
          attemptNumber: 1,
          visitorId: 'v1',
          createdAt: 3000 + i,
          expiresAt: 3000 + i + 3600000,
          sizeBytes: 10 * mib,
          traceId: `trace-multi-${i}`,
        });
      }
      const evictedMulti = planEvictions(syntheticMulti, 20 * mib);
      assert.equal(evictedMulti.length, 2, 'must evict 2 entries (20 MiB) to free at least 14 MiB');
      assert.deepEqual(evictedMulti, ['trace-multi-0', 'trace-multi-1'], 'must evict the 2 oldest entries in order');

      // 3. Duplicate replacement does not count as overflow
      const dupP1 = path.join(os.tmpdir(), `trace-t8-dup1-${randomUUID()}.zip`);
      const dupP2 = path.join(os.tmpdir(), `trace-t8-dup2-${randomUUID()}.zip`);
      tempFiles.push(dupP1, dupP2);
      await fs.writeFile(dupP1, Buffer.alloc(500, 0x44));
      await fs.writeFile(dupP2, Buffer.alloc(600, 0x45));

      const meta = {
        jobId: 'trace-t8-dup-job',
        testCaseId: 'tc-t8',
        attemptNumber: 1,
        visitorId: 'trace-t8-visitor',
      };

      const t1 = await registerTrace(dupP1, meta);
      assert.ok(t1, 'first registration must succeed');
      const t2 = await registerTrace(dupP2, meta);
      assert.ok(t2, 'duplicate registration must succeed');
      assert.notEqual(t1, t2);
      assert.equal(getTrace(t1), null, 'old duplicate trace must be evicted');
      assert.ok(getTrace(t2), 'new trace must exist');

      // 4. Stable tie-breaking on identical createdAt: insertion order preserved
      const tiedEntries: TraceEntry[] = [
        { jobId: 'j1', testCaseId: 't1', attemptNumber: 1, visitorId: 'v1', createdAt: 5000, expiresAt: 6000, sizeBytes: 100, traceId: 'tie-1' },
        { jobId: 'j2', testCaseId: 't2', attemptNumber: 1, visitorId: 'v1', createdAt: 5000, expiresAt: 6000, sizeBytes: 100, traceId: 'tie-2' },
        { jobId: 'j3', testCaseId: 't3', attemptNumber: 1, visitorId: 'v1', createdAt: 5000, expiresAt: 6000, sizeBytes: 100, traceId: 'tie-3' },
      ];
      // Max 2 traces: evicts 2 entries to make room for 1
      const tieEvicted = planEvictions(tiedEntries, 100, 2, MAX_TOTAL_TRACE_BYTES);
      assert.deepEqual(tieEvicted, ['tie-1', 'tie-2'], 'must evict earlier-inserted entries first on createdAt tie');

      pass('T8 FIFO/count + byte eviction planning');
    });
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
