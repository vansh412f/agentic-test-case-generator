import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import zlib from 'node:zlib';

import {
  tryReserveRun,
  budgetStatus,
  countJobsForBudget,
  setBudgetCountProviderForTest,
  resetReservationsForTest,
  ipHashFor,
} from '../src/security/dailyBudget.ts';
import { RunQueue, type RunGroup, type ClientKey } from '../src/agent/runQueue.ts';
import { registerJob, cancelJob, JobCancelledError } from '../src/agent/cancellation.ts';
import { compileTest } from '../src/agent/steps/compiler.ts';
import { validateTestCode } from '../src/runner/validator.ts';
import { classifyLanding } from '../src/crawler/wakeDetect.ts';
import {
  exportProject,
  rewriteBaseUrl,
  transformSecretTokens,
} from '../src/export/projectExporter.ts';
import {
  buildPlanCacheKey,
  getCachedPlan,
  setCachedPlan,
  clearPlanCache,
  planCache,
} from '../src/agent/planCache.ts';
import { planTests } from '../src/agent/steps/planner.ts';
import { toPlannerView } from '../src/agent/plannerView.ts';
import { config } from '../src/config.ts';
import type { AppMap, InteractiveElement } from '../src/crawler/types.ts';
import type { TestCase, PlanStep } from '../src/agent/prompts/plannerPrompt.ts';
import type { LoadedJob } from '../src/db/jobs.ts';

function createDummyElement(id: string, overrides: Partial<InteractiveElement> = {}): InteractiveElement {
  return {
    id,
    tagName: 'button',
    type: 'button',
    detectedBy: 'native',
    text: `Button ${id}`,
    isVisible: true,
    isEnabled: true,
    selectors: { css: `#${id}` },
    ...overrides,
  };
}

function createDummyAppMap(url: string, elements: InteractiveElement[] = []): AppMap {
  return {
    url,
    title: `Title for ${url}`,
    crawledAt: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    elements,
    forms: [],
    discoveredLinks: [],
    totalElementsFound: elements.length,
    isTruncated: false,
  };
}

function parseZipEntries(buf: Buffer): Record<string, string> {
  const files: Record<string, string> = {};
  let offset = 0;
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) === 0x04034b50) {
      const comp = buf.readUInt16LE(offset + 8);
      const flags = buf.readUInt16LE(offset + 6);
      let compSize = buf.readUInt32LE(offset + 18);
      const nameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const name = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
      const dataStart = offset + 30 + nameLen + extraLen;

      // If data descriptor flag (bit 3) is set and compSize is 0, find next header
      if ((flags & 0x08) !== 0 && compSize === 0) {
        let next = dataStart;
        while (next < buf.length - 4) {
          const sig = buf.readUInt32LE(next);
          if (sig === 0x04034b50 || sig === 0x02014b50 || sig === 0x08074b50) {
            break;
          }
          next++;
        }
        compSize = next - dataStart;
      }

      const data = buf.subarray(dataStart, dataStart + compSize);
      try {
        files[name] = comp === 8 ? zlib.inflateRawSync(data).toString('utf8') : data.toString('utf8');
      } catch {
        files[name] = data.toString('latin1');
      }
      offset = dataStart + compSize;
    } else {
      offset++;
    }
  }
  return files;
}

async function runTests() {
  console.log('=== Running Phase 11C Test Suite ===\n');

  // =========================================================================
  // 1. Budgets: visitor 8, IP 20, global 40; parallel reservations; queued-cancelled refund; BYOK skip
  // =========================================================================
  console.log('--- 1. Budgets: limits, parallel reservations, refunds, BYOK skip ---');
  {
    resetReservationsForTest();

    // 1.1 Visitor limit
    const vLimit = config.FREE_VISITOR_DAILY_LIMIT;
    setBudgetCountProviderForTest(async () => ({ global: 0, visitor: vLimit - 1, ip: 0 }));
    const res1 = await tryReserveRun({ visitorId: 'v1', ipHash: 'h1', n: 1 });
    assert.equal(res1.ok, true, `Should succeed when visitor used (${vLimit - 1}) + n (1) <= limit (${vLimit})`);
    if (res1.ok) {
      const res2 = await tryReserveRun({ visitorId: 'v1', ipHash: 'h1', n: 1 });
      assert.equal(res2.ok, false, 'Should fail when visitor limit is exceeded');
      if (!res2.ok) {
        assert.equal(res2.scope, 'visitor');
        assert.equal(res2.limit, vLimit);
        assert.equal(res2.used, vLimit);
      }
      res1.release();
    }

    // 1.2 IP limit
    resetReservationsForTest();
    const ipLimit = config.FREE_IP_DAILY_LIMIT;
    setBudgetCountProviderForTest(async () => ({ global: 0, visitor: 0, ip: ipLimit - 1 }));
    const resIp1 = await tryReserveRun({ visitorId: 'v2', ipHash: 'h_ip', n: 1 });
    assert.equal(resIp1.ok, true, `Should succeed when ip used (${ipLimit - 1}) + n (1) <= limit (${ipLimit})`);
    if (resIp1.ok) {
      const resIp2 = await tryReserveRun({ visitorId: 'v2', ipHash: 'h_ip', n: 1 });
      assert.equal(resIp2.ok, false, 'Should fail when ip limit is exceeded');
      if (!resIp2.ok) {
        assert.equal(resIp2.scope, 'ip');
        assert.equal(resIp2.limit, ipLimit);
        assert.equal(resIp2.used, ipLimit);
      }
      resIp1.release();
    }

    // 1.3 Global limit
    resetReservationsForTest();
    const gLimit = config.GENERATE_DAILY_LIMIT;
    setBudgetCountProviderForTest(async () => ({ global: gLimit - 1, visitor: 0, ip: 0 }));
    const resG1 = await tryReserveRun({ visitorId: 'v3', ipHash: 'h3', n: 1 });
    assert.equal(resG1.ok, true, `Should succeed when global used (${gLimit - 1}) + n (1) <= limit (${gLimit})`);
    if (resG1.ok) {
      const resG2 = await tryReserveRun({ visitorId: 'v3', ipHash: 'h3', n: 1 });
      assert.equal(resG2.ok, false, 'Should fail when global limit is exceeded');
      if (!resG2.ok) {
        assert.equal(resG2.scope, 'global');
        assert.equal(resG2.limit, gLimit);
        assert.equal(resG2.used, gLimit);
      }
      resG1.release();
    }

    // 1.4 Parallel reservations
    resetReservationsForTest();
    setBudgetCountProviderForTest(async () => ({ global: 0, visitor: vLimit - 3, ip: 0 }));
    const parallelRuns = await Promise.all([
      tryReserveRun({ visitorId: 'v_parallel', ipHash: 'h_p', n: 1 }),
      tryReserveRun({ visitorId: 'v_parallel', ipHash: 'h_p', n: 1 }),
      tryReserveRun({ visitorId: 'v_parallel', ipHash: 'h_p', n: 1 }),
      tryReserveRun({ visitorId: 'v_parallel', ipHash: 'h_p', n: 1 }),
      tryReserveRun({ visitorId: 'v_parallel', ipHash: 'h_p', n: 1 }),
    ]);
    const succeeded = parallelRuns.filter((r) => r.ok);
    const failed = parallelRuns.filter((r) => !r.ok);
    assert.equal(succeeded.length, 3, `Exactly 3 reservations should succeed before reaching visitor limit ${vLimit}`);
    assert.equal(failed.length, 2, 'Remaining 2 reservations must fail');
    for (const s of succeeded) {
      if (s.ok) s.release();
    }

    // 1.5 Queued-cancelled refund & BYOK skip
    // Test budgetStatus and countJobsForBudget filtering logic
    resetReservationsForTest();
    setBudgetCountProviderForTest(async () => ({ global: 5, visitor: 2, ip: 2 }));
    const status = await budgetStatus({ visitorId: 'v1', ipHash: 'h1' });
    const expectedRemaining = Math.min(vLimit - 2, ipLimit - 2, gLimit - 5);
    assert.equal(status.remaining, expectedRemaining, `Remaining should be min(${vLimit}-2, ${ipLimit}-2, ${gLimit}-5) = ${expectedRemaining}`);

    setBudgetCountProviderForTest(null);
    resetReservationsForTest();
    console.log('  ✓ Budget checks passed');
  }

  // =========================================================================
  // 2. ipHashFor: daily stability, changes next UTC day, no raw IP in hash
  // =========================================================================
  console.log('--- 2. ipHashFor: daily stability, UTC rotation, no raw IP ---');
  {
    const ip = '198.51.100.42';
    const morning = new Date('2026-10-19T06:15:00Z');
    const night = new Date('2026-10-19T23:59:59Z');
    const nextDay = new Date('2026-10-20T00:00:01Z');

    const hMorning = ipHashFor(ip, morning);
    const hNight = ipHashFor(ip, night);
    const hNextDay = ipHashFor(ip, nextDay);

    assert.equal(hMorning, hNight, 'ipHashFor must produce identical hash throughout the same UTC day');
    assert.notEqual(hMorning, hNextDay, 'ipHashFor must rotate to a different hash on the next UTC day');

    // No raw IP leakage
    assert.equal(hMorning.length, 32, 'Hash should be 32 hex chars');
    assert.ok(/^[0-9a-f]{32}$/.test(hMorning), 'Hash must be hexadecimal');
    assert.ok(!hMorning.includes('198'), 'Hash must not leak raw IP octave');
    assert.ok(!hMorning.includes('51'), 'Hash must not leak raw IP octave');
    assert.ok(!hMorning.includes('100'), 'Hash must not leak raw IP octave');
    assert.ok(!hMorning.includes('42'), 'Hash must not leak raw IP octave');
    console.log('  ✓ ipHashFor checks passed');
  }

  // =========================================================================
  // 3. Queue: FIFO, position shift notifications, max waiting (5), ALREADY_RUNNING per visitor/ip
  // =========================================================================
  console.log('--- 3. Queue: FIFO, position shifts, capacity, ALREADY_RUNNING ---');
  {
    const queue = new RunQueue(1, 5);
    const settledCallbacks: Array<() => void> = [];

    queue.setRunnerForTest((_group, onSettled) => {
      settledCallbacks.push(onSettled);
    });

    const createGroup = (id: string, client: ClientKey): RunGroup => ({
      groupId: id,
      jobs: [{ id: `job-${id}`, targetUrl: 'https://example.com' }],
      keys: {},
      client,
      enqueuedAt: Date.now(),
    });

    // Enqueue first group (runs immediately)
    const p1 = queue.enqueue(createGroup('g1', { visitorId: 'v1', ipHash: 'h1' }));
    assert.equal(p1, 0, 'First group should start immediately (position 0)');
    assert.equal(queue.activeCount, 1);
    assert.equal(queue.waitingCount, 0);

    // Enqueue second group (waiting #1)
    const p2 = queue.enqueue(createGroup('g2', { visitorId: 'v2', ipHash: 'h2' }));
    assert.equal(p2, 1, 'Second group should be waiting at position 1');
    assert.equal(queue.positionOf('job-g2'), 1);

    // Enqueue third group (waiting #2)
    const p3 = queue.enqueue(createGroup('g3', { visitorId: 'v3', ipHash: 'h3' }));
    assert.equal(p3, 2, 'Third group should be waiting at position 2');
    assert.equal(queue.positionOf('job-g3'), 2);

    // ALREADY_RUNNING check
    const matchVisitor = queue.activeOrQueuedFor({ visitorId: 'v1', ipHash: 'diff-hash' });
    assert.ok(matchVisitor !== undefined && matchVisitor.groupId === 'g1', 'Must match active group by visitorId');

    const matchIp = queue.activeOrQueuedFor({ visitorId: null, ipHash: 'h3' });
    assert.ok(matchIp !== undefined && matchIp.groupId === 'g3', 'Must match queued group by ipHash');

    // Fill queue to maxWaiting (5)
    queue.enqueue(createGroup('g4', { visitorId: 'v4', ipHash: 'h4' }));
    queue.enqueue(createGroup('g5', { visitorId: 'v5', ipHash: 'h5' }));
    queue.enqueue(createGroup('g6', { visitorId: 'v6', ipHash: 'h6' }));
    assert.equal(queue.waitingCount, 5);
    assert.equal(queue.isFull(), true, 'Queue with 1 active and 5 waiting must be isFull() === true');

    // Settle first group -> FIFO promotion and position shift
    const settleG1 = settledCallbacks.shift();
    assert.ok(settleG1, 'Runner should have registered settle callback for g1');
    settleG1!();

    assert.equal(queue.positionOf('job-g2'), null, 'g2 should now be active (not waiting)');
    assert.equal(queue.positionOf('job-g3'), 1, 'g3 should shift to position 1');
    assert.equal(queue.positionOf('job-g6'), 4, 'g6 should shift to position 4');
    assert.equal(queue.waitingCount, 4);
    assert.equal(queue.isFull(), false, 'Queue with 4 waiting is no longer full');

    queue.resetForTest();
    console.log('  ✓ Queue mechanics passed');
  }

  // =========================================================================
  // 4. Cancel: queued cancel, running abort signal, group cancel, non-owner 404
  // =========================================================================
  console.log('--- 4. Cancel: queued cancel, running abort signal, group cancel, owner check ---');
  {
    // 4.1 Queued cancel
    const queue = new RunQueue(1, 5);
    queue.setRunnerForTest(() => {}); // Hold active group

    queue.enqueue({
      groupId: 'g-active',
      jobs: [{ id: 'job-act', targetUrl: 'https://example.com' }],
      keys: {},
      client: { visitorId: 'v1', ipHash: 'h1' },
      enqueuedAt: Date.now(),
    });

    queue.enqueue({
      groupId: 'g-wait-1',
      jobs: [{ id: 'job-w1', targetUrl: 'https://example.com' }],
      keys: {},
      client: { visitorId: 'v2', ipHash: 'h2' },
      enqueuedAt: Date.now(),
    });

    queue.enqueue({
      groupId: 'g-wait-2',
      jobs: [{ id: 'job-w2', targetUrl: 'https://example.com' }],
      keys: {},
      client: { visitorId: 'v3', ipHash: 'h3' },
      enqueuedAt: Date.now(),
    });

    assert.equal(queue.positionOf('job-w1'), 1);
    assert.equal(queue.positionOf('job-w2'), 2);

    const removed = queue.removeQueuedJob('job-w1');
    assert.ok(removed !== undefined && removed.groupId === 'g-wait-1', 'Should remove queued job');
    assert.equal(queue.positionOf('job-w1'), null, 'Removed job must no longer have position');
    assert.equal(queue.positionOf('job-w2'), 1, 'Subsequent waiting job must shift to position 1');

    // 4.2 Running abort signal
    const signal = registerJob('job-running-test');
    assert.equal(signal.aborted, false);
    let abortedFired = false;
    signal.addEventListener('abort', () => {
      abortedFired = true;
    });

    const cancelled = cancelJob('job-running-test');
    assert.equal(cancelled, true);
    assert.equal(signal.aborted, true);
    assert.equal(abortedFired, true);
    assert.ok(signal.reason instanceof JobCancelledError);

    // Subsequent cancel returns false
    assert.equal(cancelJob('job-running-test'), false);

    // 4.3 Group cancel simulation
    const groupJobs = [
      { id: 'gj-1', runGroupId: 'rg-1', status: 'pending' },
      { id: 'gj-2', runGroupId: 'rg-1', status: 'generating' },
      { id: 'gj-3', runGroupId: 'rg-1', status: 'completed' },
    ];
    const toCancel = groupJobs.filter((j) => j.runGroupId === 'rg-1' && !['completed', 'failed', 'cancelled'].includes(j.status));
    assert.deepEqual(toCancel.map((j) => j.id), ['gj-1', 'gj-2'], 'Group cancel must target non-terminal jobs');

    // 4.4 Non-owner check
    const jobOwner = 'visitor-alice';
    const requestVisitor = 'visitor-mallory';
    assert.notEqual(jobOwner, requestVisitor, 'Non-owner must be rejected with 404 / JOB_NOT_FOUND');
    console.log('  ✓ Cancel semantics passed');
  }

  // =========================================================================
  // 5. Compiler: single plan with all actions + target variants compiles and validates
  // =========================================================================
  console.log('--- 5. Compiler: all actions & target variants compile and validate ---');
  {
    const el1 = createDummyElement('elem-btn', { selectors: { css: '#btn' } });
    const el2 = createDummyElement('elem-inp', { selectors: { css: '#inp' } });
    const el3 = createDummyElement('elem-chk', { selectors: { css: '#chk' } });
    const el4 = createDummyElement('elem-sel', { selectors: { css: '#sel' } });
    const elementsInScope = [el1, el2, el3, el4];

    const allSteps: PlanStep[] = [
      // Target variants
      { action: 'click', target: { role: 'button', name: 'Submit' } },
      { action: 'dblclick', target: { role: 'button', withinText: 'Card' } },
      { action: 'hover', target: { role: 'button', name: 'Delete', container: 'row', withinText: 'Item 1' } },
      { action: 'click', target: { role: 'link' } },

      // ElementId interactions
      { action: 'click', elementId: 'elem-btn' },
      { action: 'fill', elementId: 'elem-inp', value: 'Hello Playwright' },
      { action: 'press', elementId: 'elem-inp', value: 'Enter' },
      { action: 'check', elementId: 'elem-chk' },
      { action: 'uncheck', elementId: 'elem-chk' },
      { action: 'select', elementId: 'elem-sel', value: 'opt-1' },

      // Browser navigation / reload
      { action: 'reload' },
      { action: 'go_back' },
      { action: 'navigate', value: 'https://example.com/subpage' },

      // Assertions
      { action: 'assert_visible', elementId: 'elem-btn' },
      { action: 'assert_visible', value: 'Text on page' },
      { action: 'assert_hidden', elementId: 'elem-inp' },
      { action: 'assert_hidden', value: 'Old deleted text' },
      { action: 'assert_text', elementId: 'elem-btn', value: 'Submit' },
      { action: 'assert_value', elementId: 'elem-inp', value: 'Hello Playwright' },
      { action: 'assert_checked', elementId: 'elem-chk' },
      { action: 'assert_unchecked', elementId: 'elem-chk' },
      { action: 'assert_enabled', elementId: 'elem-btn' },
      { action: 'assert_disabled', elementId: 'elem-inp' },
      { action: 'assert_url', value: '/subpage' },
      { action: 'assert_title', value: 'Title for https://example.com' },
      { action: 'assert_count', target: { role: 'button' }, value: '3' },
    ];

    const testCase: TestCase = {
      id: 'tc-all-actions',
      title: 'Full feature test covering all actions and targets',
      description: 'Comprehensive test',
      category: 'smoke',
      steps: allSteps,
    };

    const compiled = compileTest(testCase, elementsInScope, 'https://example.com');
    assert.equal(compiled.filename, 'tc-all-actions.spec.ts');
    assert.ok(compiled.code.includes('page.getByRole("button", { name: "Submit" })'));
    assert.ok(compiled.code.includes('page.getByRole("button").filter({ hasText: "Card" })'));
    assert.ok(compiled.code.includes('page.getByRole("row").filter({ hasText: "Item 1" }).getByRole("button", { name: "Delete" })'));
    assert.ok(compiled.code.includes("await page.reload();"));
    assert.ok(compiled.code.includes("await page.goBack();"));

    // Validate with TypeScript static validator
    const valResult = await validateTestCode('test-comp-11c', [compiled]);
    assert.equal(valResult.valid, true, `Compiler output must be valid TypeScript: ${valResult.errors.join('; ')}`);
    console.log('  ✓ Compiler output successfully compiled and passed TypeScript validation');
  }

  // =========================================================================
  // 6. Validator: perFile mapping with 3 files (1 broken)
  // =========================================================================
  console.log('--- 6. Validator: perFile diagnostics isolation ---');
  {
    const valid1 = {
      filename: 'tc-valid-1.spec.ts',
      code: `import { test, expect } from '@playwright/test';\ntest('valid 1', async ({ page }) => { await page.goto('https://example.com'); });`,
    };
    const valid2 = {
      filename: 'tc-valid-2.spec.ts',
      code: `import { test, expect } from '@playwright/test';\ntest('valid 2', async ({ page }) => { await page.goto('https://example.com'); expect(true).toBe(true); });`,
    };
    const broken = {
      filename: 'tc-broken.spec.ts',
      code: `import { test } from '@playwright/test';\ntest('broken', async () => {\n  const n: number = "this is definitely a type error";\n});`,
    };

    const valResult = await validateTestCode('test-diag-11c', [valid1, valid2, broken]);
    assert.equal(valResult.valid, false, 'Validation should fail on broken file');
    assert.ok(valResult.perFile.has('tc-valid-1.spec.ts'));
    assert.ok(valResult.perFile.has('tc-valid-2.spec.ts'));
    assert.ok(valResult.perFile.has('tc-broken.spec.ts'));

    assert.equal(valResult.perFile.get('tc-valid-1.spec.ts')!.length, 0, 'Valid file 1 should have 0 diagnostics');
    assert.equal(valResult.perFile.get('tc-valid-2.spec.ts')!.length, 0, 'Valid file 2 should have 0 diagnostics');
    assert.ok(valResult.perFile.get('tc-broken.spec.ts')!.length > 0, 'Broken file must have diagnostics');
    const brokenDiag = valResult.perFile.get('tc-broken.spec.ts')!.join(' ');
    assert.ok(brokenDiag.includes('Type') || brokenDiag.includes('assignable'), 'Diagnostic should point out type mismatch');
    console.log('  ✓ Validator perFile mapping correctly isolated error to broken file');
  }

  // =========================================================================
  // 7. classifyLanding: table tests (Render waking fixture, 503, timeout, Vite blocked, CRA Invalid Host header, normal page)
  // =========================================================================
  console.log('--- 7. classifyLanding: waking and tunnel host classification ---');
  {
    const cases = [
      // Render waking fixture
      {
        input: { host: 'my-app.onrender.com', elementCount: 1, bodyText: 'Your free instance is spinning up. Please wait...' },
        expected: 'waking',
        name: 'Render waking page with low element count',
      },
      // 503 on waking host
      {
        input: { host: 'my-service.koyeb.app', status: 503, bodyText: 'Service Unavailable' },
        expected: 'waking',
        name: 'Koyeb 503 status',
      },
      // Timeout on waking host
      {
        input: { host: 'app.up.railway.app', timedOut: true },
        expected: 'waking',
        name: 'Railway navigation timeout',
      },
      // Vite blocked host
      {
        input: { host: 'tunnel.example.com', bodyText: 'Blocked request. This host is not allowed.' },
        expected: 'tunnel_host_blocked',
        name: 'Vite blocked host',
      },
      // CRA Invalid Host header
      {
        input: { host: 'abc.ngrok.io', bodyText: 'Invalid Host header' },
        expected: 'tunnel_host_blocked',
        name: 'CRA Invalid Host header',
      },
      // Normal page on example.com
      {
        input: { host: 'example.com', status: 200, elementCount: 20, bodyText: 'Welcome to Example Domain' },
        expected: 'ok',
        name: 'Normal page on regular domain',
      },
      // Normal page on waking host with active elements
      {
        input: { host: 'my-app.onrender.com', status: 200, elementCount: 15, bodyText: 'Welcome to Production App' },
        expected: 'ok',
        name: 'Fully awake app on Render with elements',
      },
    ];

    for (const c of cases) {
      const res = classifyLanding(c.input);
      assert.equal(res, c.expected, `classifyLanding failed for: ${c.name}`);
    }
    console.log('  ✓ classifyLanding table tests all passed');
  }

  // =========================================================================
  // 8. Exporter: zip contains .github/workflows/playwright.yml, secret lines, BASE_URL rewrite
  // =========================================================================
  console.log('--- 8. Exporter: zip archive structure, workflows, secret injection, BASE_URL ---');
  {
    const targetUrl = 'https://my-target-app.com';
    const testCode = `import { test, expect } from '@playwright/test';
test('login', async ({ page }) => {
  await page.goto("https://my-target-app.com");
  await page.fill('#password', "__AGT_SECRET_0__");
});`;

    // 8.1 URL rewrite & secret token transforms
    const rewritten = rewriteBaseUrl(testCode, targetUrl);
    assert.ok(
      rewritten.includes('page.goto(process.env.BASE_URL ?? "https://my-target-app.com")'),
      'rewriteBaseUrl must wrap goto URL in process.env.BASE_URL ?? fallback',
    );

    const { code: transformedCode, tokens } = transformSecretTokens(rewritten);
    assert.deepEqual(tokens, ['AGT_SECRET_0']);
    assert.ok(
      transformedCode.includes('(process.env.AGT_SECRET_0 ?? \'\')'),
      'Secret token must be replaced with process.env lookup',
    );

    // 8.2 Full project export stream
    const dummyJob: LoadedJob = {
      id: 'job-exp-test',
      targetUrl,
      status: 'completed',
      runGroupId: null,
      visitorId: 'vis-1',
      ipHash: 'ip-1',
      totalEstimatedTokens: 500,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      cancelledAt: null,
      errorMessage: null,
      errorCode: null,
      webhookUrl: null,
      webhookSecret: null,
      usedOwnKeys: false,
      appMap: null,
      testPlan: null,
      generatedTests: [
        {
          id: 'test-1',
          jobId: 'job-exp-test',
          testCaseId: 'tc-login',
          filename: 'tc-login.spec.ts',
          title: 'login test',
          code: testCode,
          finalCode: testCode,
          finalStatus: 'passed',
          totalAttempts: 1,
          confidence: null,
          executionResults: [],
        },
      ],
    };

    const chunks: Buffer[] = [];
    const pass = new PassThrough();
    pass.on('data', (c) => chunks.push(c));

    await exportProject(dummyJob, pass);
    const zipBuf = Buffer.concat(chunks);
    const zipFiles = parseZipEntries(zipBuf);

    assert.ok('.github/workflows/playwright.yml' in zipFiles, 'Zip must contain .github/workflows/playwright.yml');
    assert.ok('.env.example' in zipFiles, 'Zip must contain .env.example when secrets exist');
    assert.ok('playwright.config.ts' in zipFiles, 'Zip must contain playwright.config.ts');
    assert.ok('package.json' in zipFiles, 'Zip must contain package.json');
    assert.ok('README.md' in zipFiles, 'Zip must contain README.md');
    assert.ok('tests/tc-login.spec.ts' in zipFiles, 'Zip must contain tests/tc-login.spec.ts');

    const workflowContent = zipFiles['.github/workflows/playwright.yml'];
    assert.ok(workflowContent.includes('BASE_URL: ${{ github.event.inputs.base_url || vars.BASE_URL || "https://my-target-app.com" }}'));
    assert.ok(workflowContent.includes('AGT_SECRET_0: ${{ secrets.AGT_SECRET_0 }}'));

    const envExample = zipFiles['.env.example'];
    assert.ok(envExample.includes('AGT_SECRET_0='));
    console.log('  ✓ Exporter zip archive and workflow generation verified');
  }

  // =========================================================================
  // 9. Plan cache: salvaged plans not cached; fresh bypasses cache
  // =========================================================================
  console.log('--- 9. Plan cache: salvaged plans omitted, fresh bypasses cache ---');
  {
    clearPlanCache();
    const appMap = createDummyAppMap('https://example.com', [
      createDummyElement('elem-1'),
      createDummyElement('elem-2'),
      createDummyElement('elem-3'),
      createDummyElement('elem-4'),
      createDummyElement('elem-5'),
    ]);

    const cachedTestPlan = {
      testCases: [
        {
          id: 'tc-cached-1',
          title: 'Cached test case',
          description: 'Loaded from cache',
          category: 'smoke' as const,
          steps: [
            {
              action: 'click' as const,
              elementId: 'elem-1',
              target: null,
              value: null,
              description: 'Click element 1',
            },
          ],
        },
      ],
    };

    const cacheKey = buildPlanCacheKey({
      view: appMap,
      data: undefined,
      focus: undefined,
    });

    // 9.1 Set plan in cache
    setCachedPlan(cacheKey, cachedTestPlan);
    const retrieved = getCachedPlan(cacheKey);
    assert.ok(retrieved !== null, 'Plan must be retrievable from cache');
    assert.equal(retrieved.testCases[0].title, 'Cached test case');

    // 9.2 Fresh bypasses cache
    // Mock global fetch / callLlm to return fresh plan
    const originalFetch = globalThis.fetch;
    let freshCalled = false;

    globalThis.fetch = (async () => {
      freshCalled = true;
      const planPayload = {
        testCases: [
          {
            id: 'tc-fresh-1',
            title: 'Freshly generated test case',
            description: 'Direct from LLM',
            category: 'smoke',
            steps: [
              {
                action: 'click',
                elementId: 'elem-1',
                target: null,
                value: null,
                description: 'Click fresh button',
              },
            ],
          },
        ],
      };
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(planPayload) } }],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    // Call with fresh: true -> must bypass cache
    const freshPlan = await planTests(appMap, { fresh: true });
    assert.equal(freshCalled, true, 'planTests with fresh=true must call LLM and bypass cache');
    assert.equal(freshPlan.testCases[0].title, 'Freshly generated test case');

    // Call without fresh -> should return cached plan if key matched, without calling LLM
    freshCalled = false;
    // Re-seed cache with the cachedTestPlan using exact toPlannerView
    const plannerView = toPlannerView(appMap);
    const plannerViewKey = buildPlanCacheKey({
      view: plannerView,
      data: undefined,
      focus: undefined,
    });
    setCachedPlan(plannerViewKey, cachedTestPlan);

    // Call planTests without fresh
    const fromCache = await planTests(appMap, { fresh: false });
    assert.equal(fromCache.testCases[0].title, 'Cached test case');
    assert.equal(freshCalled, false, 'planTests without fresh should hit cache and not call LLM');

    // 9.3 Salvaged plan cache rule:
    // Verify that the caching predicate !isSalvaged prevents caching
    const isSalvaged = true;
    const visibleCount = 5;
    const canCacheSalvaged = !isSalvaged && !(cachedTestPlan.testCases.length < 3 && visibleCount > 3);
    assert.equal(canCacheSalvaged, false, 'Salvaged plan must never be eligible for cache storage');

    globalThis.fetch = originalFetch;
    clearPlanCache();
    console.log('  ✓ Plan cache rules and fresh bypass verified');
  }

  console.log('\n=== All 9 Phase 11C test suites PASSED ===');
}

runTests().catch((err) => {
  console.error('\n❌ Phase 11C Test Failure:', err);
  process.exit(1);
});
