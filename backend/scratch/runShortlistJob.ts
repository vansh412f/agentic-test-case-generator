import dotenv from 'dotenv';
dotenv.config();

import { randomUUID } from 'node:crypto';
import { prisma } from '../src/db/client.ts';
import { getJobById, createPendingJobs } from '../src/db/jobs.ts';
import { startDetachedRun } from '../src/agent/jobRunner.ts';
import { ensureEgressProxy, stopEgressProxy } from '../src/security/egressProxy.ts';
import type { TestDataEntry } from '../src/api/schemas.ts';

const siteArg = process.argv.find((a) => a.startsWith('--site='))?.split('=')[1] ?? 'todomvc';
const configArg = process.argv.find((a) => a.startsWith('--config='))?.split('=')[1] ?? 'groq_primary';

async function main() {
  console.log(`[ShortlistRunner] Starting job for site=${siteArg}, config=${configArg}`);

  let targetUrl = 'https://demo.playwright.dev/todomvc';
  let testData: TestDataEntry[] | undefined = undefined;

  if (siteArg === 'saucedemo') {
    targetUrl = 'https://www.saucedemo.com/';
    testData = [
      { elementId: 'user-name', css: '#user-name', value: 'standard_user', sensitive: false },
      { elementId: 'password', css: '#password', value: 'secret_sauce', sensitive: true },
    ];
  }

  await ensureEgressProxy();

  const jobId = randomUUID();
  const visitorId = `visitor-shortlist-${randomUUID().slice(0, 8)}`;

  await createPendingJobs(
    [{ id: jobId, targetUrl }],
    { visitorId, usedOwnKeys: false, ipHash: null, runGroupId: null },
  );

  const startTime = Date.now();

  await new Promise<void>((resolve) => {
    startDetachedRun(
      [
        {
          id: jobId,
          url: targetUrl,
          fresh: true,
          testData,
        },
      ],
      {},
      { onSettled: resolve },
    );
  });

  const wallTimeMs = Date.now() - startTime;

  // Query DB
  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      agentSteps: { orderBy: { createdAt: 'asc' } },
      generatedTests: {
        orderBy: { createdAt: 'asc' },
        include: { executionResults: { orderBy: { attemptNumber: 'asc' } } },
      },
    },
  });

  if (!dbJob) {
    throw new Error(`Job ${jobId} not found in DB`);
  }

  const aiTests = dbJob.generatedTests.filter((t) => !t.testCaseId.startsWith('smoke-'));
  const baselineTests = dbJob.generatedTests.filter((t) => t.testCaseId.startsWith('smoke-'));

  const passedTests = dbJob.generatedTests.filter((t) => t.finalStatus === 'passed').length;
  const failedTests = dbJob.generatedTests.filter((t) => t.finalStatus === 'failed').length;
  const gaveUpTests = dbJob.generatedTests.filter((t) => t.finalStatus === 'gave_up').length;
  const needsReviewTests = dbJob.generatedTests.filter((t) => t.finalStatus === 'needs_review').length;

  let healedCount = 0;
  for (const t of dbJob.generatedTests) {
    if (t.finalStatus === 'passed' && t.totalAttempts > 1) {
      healedCount++;
    }
  }

  // LLM calls & tokens by task label
  const llmByTask: Record<string, { calls: number; tokens: number }> = {};
  for (const step of dbJob.agentSteps) {
    const task = step.stepType;
    if (!llmByTask[task]) {
      llmByTask[task] = { calls: 0, tokens: 0 };
    }
    llmByTask[task].calls++;
    llmByTask[task].tokens += (step.promptTokens ?? 0) + (step.completionTokens ?? 0);
  }

  // Test adjudications
  const adjudications: Array<{ testCaseId: string; status: string; adjudication: string }> = [];
  for (const t of dbJob.generatedTests) {
    let adj = 'passed';
    if (t.finalStatus !== 'passed') {
      const lastRes = t.executionResults?.[t.executionResults.length - 1];
      const err = lastRes?.executionError || '';
      if (err.includes('Timeout') || err.includes('waiting for locator')) {
        adj = 'mechanical locator-timeout';
      } else if (err.includes('toContainText') || (err.includes('Expected') && err.includes('Received'))) {
        adj = 'assertion mismatch (input value vs container text)';
      } else if (err.includes('negative') || err.includes('error')) {
        adj = 'negative contradiction';
      } else if (err.includes('stale') || err.includes('detached')) {
        adj = 'stale expectation';
      } else {
        adj = `other: ${lastRes?.failureClass ?? 'unclassified'}`;
      }
    }
    adjudications.push({
      testCaseId: t.testCaseId,
      status: t.finalStatus,
      adjudication: adj,
    });
  }

  const result = {
    jobId,
    site: siteArg,
    config: configArg,
    targetUrl,
    wallTimeMs,
    jobStatus: dbJob.status,
    totalTests: dbJob.generatedTests.length,
    aiTestCount: aiTests.length,
    baselineCount: baselineTests.length,
    passedCount: passedTests,
    failedCount: failedTests,
    gaveUpCount: gaveUpTests,
    needsReviewCount: needsReviewTests,
    healedCount,
    llmByTask,
    adjudications,
  };

  console.log('--- SHORTLIST RESULT JSON ---');
  console.log(JSON.stringify(result));

  await stopEgressProxy();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[ShortlistRunner Error]', err);
  await stopEgressProxy().catch(() => {});
  process.exit(1);
});
