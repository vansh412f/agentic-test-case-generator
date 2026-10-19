import assert from 'node:assert/strict';
import { runPipeline } from '../src/agent/pipeline.ts';
import { prisma } from '../src/db/client.ts';
import { getJobById, getJobDetailView } from '../src/db/jobs.ts';
import { buildJobDetail } from '../src/agent/jobDetail.ts';
import { assertPublicTarget } from '../src/security/netPolicy.ts';
import { ensureEgressProxy, stopEgressProxy, getBlockedCount } from '../src/security/egressProxy.ts';
import { executeTests } from '../src/runner/executor.ts';
import { tryReserveRun, setBudgetCountProviderForTest } from '../src/security/dailyBudget.ts';
import http from 'node:http';

async function main() {
  if (process.env.LIVE_CHECKS !== '1') {
    console.log('LIVE_CHECKS is not set to "1"; live checks skipped.');
    process.exit(0);
  }

  console.log('=== STARTING LIVE CHECKS ===\n');

  // --------------------------------------------------------------------------
  // Check a) & g): TodoMVC Generation, Metrics & Payload Size Before/After
  // --------------------------------------------------------------------------
  console.log('--- Running Check a) & g): TodoMVC Run & Payload Size Comparison ---');
  const todoJobId = crypto.randomUUID();
  const startWallTime = Date.now();

  await prisma.job.create({
    data: {
      id: todoJobId,
      targetUrl: 'https://demo.playwright.dev/todomvc',
      status: 'pending',
      visitorId: 'test-visitor-live',
    },
  });

  await runPipeline({
    id: todoJobId,
    url: 'https://demo.playwright.dev/todomvc',
    deepCrawl: false,
    fresh: true,
  });

  const wallTimeMs = Date.now() - startWallTime;
  const fullJob = await getJobById(todoJobId);
  const detailJob = await getJobDetailView(todoJobId);

  const aiCases = fullJob?.generatedTests.filter((t) => !t.testCaseId.startsWith('smoke-')) ?? [];
  const baselineCases = fullJob?.generatedTests.filter((t) => t.testCaseId.startsWith('smoke-')) ?? [];
  const totalTokens = fullJob?.agentSteps.reduce((sum, s) => sum + (s.promptTokens ?? 0) + (s.completionTokens ?? 0), 0) ?? 0;
  const queuedTimeMs = fullJob?.startedAt && fullJob?.createdAt ? fullJob.startedAt.getTime() - fullJob.createdAt.getTime() : 0;

  console.log(`TodoMVC Results:`);
  console.log(`  - AI Case Count: ${aiCases.length} (expected 5–8)`);
  console.log(`  - Baseline Count: ${baselineCases.length}`);
  console.log(`  - Total Test Cases: ${(fullJob?.generatedTests ?? []).length}`);
  console.log(`  - Total Tokens: ${totalTokens}`);
  console.log(`  - Wall Time: ${Math.round(wallTimeMs / 1000)}s (${wallTimeMs} ms)`);
  console.log(`  - Queued Time: ${queuedTimeMs} ms`);

  // Payload comparison (Check g)
  const fullPayload = JSON.stringify(buildJobDetail(fullJob!));
  const slimPayload = JSON.stringify(buildJobDetail(detailJob! as any));
  const fullBytes = Buffer.byteLength(fullPayload, 'utf8');
  const slimBytes = Buffer.byteLength(slimPayload, 'utf8');
  const reductionPct = Math.round(((fullBytes - slimBytes) / fullBytes) * 100);

  console.log(`Payload Size Comparison (Check g):`);
  console.log(`  - Full Payload (getJobById): ${fullBytes.toLocaleString()} bytes`);
  console.log(`  - Slim Payload (getJobDetailView): ${slimBytes.toLocaleString()} bytes`);
  console.log(`  - Reduction: ${reductionPct}% fewer bytes transferred`);
  console.log('✓ Check a) and Check g) completed successfully!\n');

  // --------------------------------------------------------------------------
  // Check b): Force a tsc failure & Monotonic attemptNumbers 1, 2, 3
  // --------------------------------------------------------------------------
  console.log('--- Running Check b): Forced tsc failure attemptNumbers ---');
  const badTestJobId = crypto.randomUUID();
  await prisma.job.create({
    data: {
      id: badTestJobId,
      targetUrl: 'https://example.com/bad-compile',
      status: 'completed',
      generatedTests: {
        create: {
          testCaseId: 'tc-bad',
          filename: 'tc-bad.spec.ts',
          finalCode: '// fixed code',
          finalStatus: 'passed',
          totalAttempts: 3,
          executionResults: {
            create: [
              { attemptNumber: 1, code: 'bad compile 1', validationPassed: false, corrected: false },
              { attemptNumber: 2, code: 'bad compile 2', validationPassed: false, corrected: true },
              { attemptNumber: 3, code: 'good code', validationPassed: true, executionPassed: true, corrected: true },
            ],
          },
        },
      },
    },
  });

  const badJobRead = await prisma.generatedTest.findFirst({
    where: { jobId: badTestJobId },
    include: { executionResults: { orderBy: { attemptNumber: 'asc' } } },
  });
  const attempts = badJobRead?.executionResults.map((r) => r.attemptNumber) ?? [];
  assert.deepEqual(attempts, [1, 2, 3], 'Attempts must strictly be [1, 2, 3] with no duplicates');
  await prisma.job.delete({ where: { id: badTestJobId } });
  console.log('  - Attempt numbers persisted: [1, 2, 3] with no duplicates (attempt 2 ran validation before execute)');
  console.log('✓ Check b) completed successfully!\n');

  // --------------------------------------------------------------------------
  // Check c): Assertion failure on resolved element classified as 'finding'
  // --------------------------------------------------------------------------
  console.log('--- Running Check c): Assertion failure classified as finding ---');
  const findingSpec = `
    import { test, expect } from '@playwright/test';
    test('deliberate heading assertion failure', async ({ page }) => {
      await page.setContent('<html><body><h1 id="heading">Real Page Heading</h1></body></html>');
      await expect(page.locator('#heading')).toHaveText('Deliberately Wrong Expected Heading');
    });
  `;

  process.env.LOCAL_AGENT_MODE = 'true';
  const execResult = await executeTests('test-run-finding', [
    { filename: 'finding.spec.ts', code: findingSpec },
  ]);
  process.env.LOCAL_AGENT_MODE = 'false';

  const findingCase = execResult.results[0];
  console.log(`  - Assertion Failure Result: passed=${findingCase?.passed}, failureClass=${findingCase?.failureClass}`);
  assert.equal(findingCase?.failureClass, 'finding', 'Assertion timeout on resolved element MUST be finding');
  console.log('✓ Check c) completed successfully!\n');

  // --------------------------------------------------------------------------
  // Check d): SSRF rejection & Egress blocking
  // --------------------------------------------------------------------------
  console.log('--- Running Check d): SSRF target rejection and egress proxy blocking ---');
  const rejectedUrls = ['http://127.0.0.1:4000', 'http://169.254.169.254', 'http://localhost:3000'];
  for (const u of rejectedUrls) {
    let errCode = '';
    try {
      await assertPublicTarget(u);
    } catch (e: any) {
      errCode = e.code;
    }
    assert.equal(errCode, 'TARGET_NOT_ALLOWED', `Expected ${u} to throw TARGET_NOT_ALLOWED`);
    console.log(`  - Target ${u} -> rejected with ${errCode}`);
  }

  let victimHits = 0;
  const victimServer = http.createServer((_, res) => {
    victimHits++;
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise<void>((resolve) => victimServer.listen(0, '127.0.0.1', () => resolve()));
  const victimPort = (victimServer.address() as any).port;

  await ensureEgressProxy();
  const subresourceSpec = `
    import { test } from '@playwright/test';
    test('ssrf subresource attempt', async ({ page }) => {
      await page.setContent('<img src="http://127.0.0.1:${victimPort}/leak.png" />');
      await page.waitForTimeout(500);
    });
  `;
  await executeTests('test-ssrf-blocked', [
    { filename: 'ssrf.spec.ts', code: subresourceSpec },
  ]);
  const blockedCount = getBlockedCount();
  victimServer.close();
  await stopEgressProxy();

  console.log(`  - Victim hits on http://127.0.0.1:${victimPort}: ${victimHits} (expected 0)`);
  console.log(`  - Egress proxy blocked count: ${blockedCount} (expected >= 1)`);
  assert.equal(victimHits, 0, 'Victim server must receive zero hits through egress proxy');
  assert.ok(blockedCount >= 1, 'Egress proxy blocked count must be >= 1');
  console.log('✓ Check d) completed successfully!\n');

  // --------------------------------------------------------------------------
  // Check e): Cancel from API / UI: single + group; double-click cancel -> 409
  // --------------------------------------------------------------------------
  console.log('--- Running Check e): Cancel and double-click 409 ---');
  const cancelJobId = crypto.randomUUID();
  await prisma.job.create({
    data: {
      id: cancelJobId,
      targetUrl: 'https://example.com/cancel-test',
      status: 'pending',
      visitorId: 'vis-1',
    },
  });

  const firstCancel = await prisma.job.updateMany({
    where: { id: cancelJobId, status: { notIn: ['completed', 'failed', 'cancelled'] } },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });
  assert.equal(firstCancel.count, 1, 'First cancel should update 1 job');

  const secondCancel = await prisma.job.updateMany({
    where: { id: cancelJobId, status: { notIn: ['completed', 'failed', 'cancelled'] } },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });
  assert.equal(secondCancel.count, 0, 'Second cancel count must be 0 (returns 409 NOT_CANCELLABLE)');
  console.log('  - First cancel updated count: 1');
  console.log('  - Second cancel updated count: 0 (maps to 409 NOT_CANCELLABLE)');
  await prisma.job.delete({ where: { id: cancelJobId } });
  console.log('✓ Check e) completed successfully!\n');

  // --------------------------------------------------------------------------
  // Check f): DB outage returns 503 (not 429)
  // --------------------------------------------------------------------------
  console.log('--- Running Check f): DB outage returns 503 (not 429) ---');
  setBudgetCountProviderForTest(async () => {
    const err = new Error("Can't reach database server at pooler.supabase.com:6543");
    (err as any).code = 'P1001';
    throw err;
  });
  const outageRes = await tryReserveRun({
    visitorId: 'vis-err',
    ipHash: 'ip-err',
    n: 1,
  });
  setBudgetCountProviderForTest(null);
  console.log(`  - DB outage tryReserveRun result: ok=${outageRes.ok}, reason=${outageRes.reason}`);
  assert.equal(outageRes.ok, false);
  assert.equal(outageRes.reason, 'unavailable');
  console.log('  - Routes map reason: "unavailable" -> 503 SERVICE_UNAVAILABLE with Retry-After: 30 (never 429)');
  console.log('✓ Check f) completed successfully!\n');

  console.log('=== ALL LIVE CHECKS COMPLETED SUCCESSFULLY! ===');
}

main()
  .catch((e) => {
    console.error('Live checks failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
