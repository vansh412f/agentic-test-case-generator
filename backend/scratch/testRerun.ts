import assert from 'node:assert/strict';
import { prisma } from '../src/db/client.ts';
import { getJobById } from '../src/db/jobs.ts';
import { buildJobDetail } from '../src/agent/jobDetail.ts';
import { startTestRerun } from '../src/agent/testRerun.ts';
import type { RerunDeps } from '../src/agent/testRerun.ts';
import type { ValidationResult } from '../src/runner/validator.ts';
import type { JobStatus, TestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

const MARKER = 'https://rerun-test.invalid/';
const VISITOR = 'rerun-test-visitor';
const OTHER_VISITOR = 'rerun-test-other-visitor';

const EDITED_CODE = [
  "import { test, expect } from '@playwright/test';",
  '',
  "test('edited test', async ({ page }) => {",
  "  await page.goto('https://example.com');",
  "  await expect(page).toHaveTitle(/Example/);",
  '});',
  '',
].join('\n');

const ORIGINAL_CODE = [
  "import { test, expect } from '@playwright/test';",
  '',
  "test('original test', async ({ page }) => {",
  "  await page.goto('https://example.com');",
  "  await expect(page).toHaveTitle(/Example/);",
  '});',
  '',
].join('\n');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CreatedFixture {
  jobId: string;
  generatedTestId: string;
}

async function createFixture(options: {
  testCaseId?: string;
  status?: JobStatus;
  visitorId?: string | null;
  finalStatus?: TestStatus;
  testPlan?: unknown;
} = {}): Promise<CreatedFixture> {
  const testCaseId = options.testCaseId ?? 'tc-edit-1';
  const job = await prisma.job.create({
    data: {
      targetUrl: MARKER,
      status: options.status ?? 'completed',
      visitorId: options.visitorId === undefined ? VISITOR : options.visitorId,
      ...(options.status === undefined || options.status === 'completed'
        ? { completedAt: new Date() }
        : {}),
      ...(options.testPlan === undefined
        ? {}
        : { testPlan: options.testPlan as Prisma.InputJsonValue }),
    },
  });

  const generatedTest = await prisma.generatedTest.create({
    data: {
      jobId: job.id,
      testCaseId,
      filename: `${testCaseId}.spec.ts`,
      finalCode: ORIGINAL_CODE,
      finalStatus: options.finalStatus ?? 'passed',
      totalAttempts: 0,
    },
  });

  return { jobId: job.id, generatedTestId: generatedTest.id };
}

function rerunInput(
  fixture: CreatedFixture,
  overrides: Partial<{
    code: string;
    visitorId: string | null;
    testCaseId: string;
    headed: boolean;
    secrets: Record<string, string>;
  }> = {},
) {
  return {
    jobId: fixture.jobId,
    testCaseId: overrides.testCaseId ?? 'tc-edit-1',
    code: overrides.code ?? EDITED_CODE,
    visitorId: overrides.visitorId === undefined ? VISITOR : overrides.visitorId,
    ipHash: 'rerun-test-ip',
    ...(overrides.headed === undefined ? {} : { headed: overrides.headed }),
    ...(overrides.secrets === undefined ? {} : { secrets: overrides.secrets }),
  };
}

function passingValidate(): RerunDeps['validate'] {
  return async (): Promise<ValidationResult> => ({
    valid: true,
    errors: [],
    perFile: new Map(),
  });
}

function hasCode(expected: string) {
  return (error: unknown): boolean => (error as { code?: string } | null)?.code === expected;
}

async function waitForAttempt(
  generatedTestId: string,
  attemptNumber: number,
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.executionResult.findUnique({
      where: { generatedTestId_attemptNumber: { generatedTestId, attemptNumber } },
    });
    if (row) return row;
    await delay(100);
  }
  throw new Error(`attempt ${attemptNumber} was not recorded within ${timeoutMs}ms`);
}

async function attemptCount(generatedTestId: string): Promise<number> {
  return prisma.executionResult.count({ where: { generatedTestId } });
}

function pass(label: string): void {
  console.log(`[PASS] ${label}`);
}

let failures = 0;

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    failures += 1;
    console.error(`[FAIL] ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  console.log('=== Rerun (edit-and-rerun) verification ===\n');

  try {
    // R1 — a job owned by someone else is indistinguishable from a missing job.
    await run('R1 wrong visitor -> JOB_NOT_FOUND', async () => {
      const fixture = await createFixture();
      await assert.rejects(
        () => startTestRerun(rerunInput(fixture, { visitorId: OTHER_VISITOR })),
        hasCode('JOB_NOT_FOUND'),
      );
      assert.equal(await attemptCount(fixture.generatedTestId), 0);
      pass('R1 wrong visitor rejected with JOB_NOT_FOUND');
    });

    // R2 — reruns only exist for finished jobs.
    await run('R2 non-terminal job -> RERUN_NOT_READY', async () => {
      const fixture = await createFixture({ status: 'executing' });
      await assert.rejects(
        () => startTestRerun(rerunInput(fixture)),
        hasCode('RERUN_NOT_READY'),
      );
      assert.equal(await attemptCount(fixture.generatedTestId), 0);
      pass('R2 running job rejected with RERUN_NOT_READY');
    });

    // R3 — baseline smoke tests are not editable.
    await run('R3 baseline test -> BASELINE_NOT_EDITABLE', async () => {
      const fixture = await createFixture({ testCaseId: 'smoke-x' });
      await assert.rejects(
        () => startTestRerun(rerunInput(fixture, { testCaseId: 'smoke-x' })),
        hasCode('BASELINE_NOT_EDITABLE'),
      );
      assert.equal(await attemptCount(fixture.generatedTestId), 0);
      pass('R3 smoke-* test rejected with BASELINE_NOT_EDITABLE');
    });

    // R3b — origin: 'baseline' in the job test plan is equally protected.
    await run("R3b planned origin 'baseline' -> BASELINE_NOT_EDITABLE", async () => {
      const fixture = await createFixture({
        testCaseId: 'tc-baseline-1',
        testPlan: { testCases: [{ id: 'tc-baseline-1', origin: 'baseline', title: 'x' }] },
      });
      await assert.rejects(
        () => startTestRerun(rerunInput(fixture, { testCaseId: 'tc-baseline-1' })),
        hasCode('BASELINE_NOT_EDITABLE'),
      );
      pass("R3b planned baseline case rejected with BASELINE_NOT_EDITABLE");
    });

    // R4 — validation failure records an attempt but leaves the test untouched.
    await run('R4 validation failure', async () => {
      const fixture = await createFixture();
      let executeCalls = 0;
      const deps: RerunDeps = {
        validate: async (): Promise<ValidationResult> => ({
          valid: false,
          errors: ['tc-edit-1.spec.ts(3,7): error TS1005: expected ";".'],
          perFile: new Map(),
        }),
        execute: async () => {
          executeCalls += 1;
          throw new Error('execute must not run when validation fails');
        },
      };

      const { attemptNumber } = await startTestRerun(rerunInput(fixture), deps);
      assert.equal(attemptNumber, 1);

      const attempt = await waitForAttempt(fixture.generatedTestId, attemptNumber);
      assert.equal(attempt.validationPassed, false);
      assert.ok(Array.isArray(attempt.validationErrors));
      assert.equal((attempt.validationErrors as string[]).length, 1);
      assert.equal(attempt.executionPassed, false);
      assert.equal(attempt.corrected, false);
      assert.deepEqual(attempt.failureContext, { source: 'rerun' });
      assert.equal(executeCalls, 0, 'invalid code must never reach the runner');

      const test = await prisma.generatedTest.findUniqueOrThrow({
        where: { id: fixture.generatedTestId },
      });
      assert.equal(test.finalCode, ORIGINAL_CODE, 'final code must not change on validation failure');
      assert.equal(test.finalStatus, 'passed', 'final status must not change on validation failure');
      assert.equal(test.totalAttempts, 1);
      pass('R4 validation failure recorded without touching final code/status');
    });

    // R5 — a passing rerun becomes the new final code and status.
    await run('R5 execution pass', async () => {
      const fixture = await createFixture({ finalStatus: 'failed' });
      const deps: RerunDeps = {
        validate: passingValidate(),
        execute: async () => ({
          success: true,
          results: [{ testCaseId: 'tc-edit-1', passed: true, durationMs: 42 }],
        }),
      };

      const { attemptNumber } = await startTestRerun(rerunInput(fixture), deps);
      const attempt = await waitForAttempt(fixture.generatedTestId, attemptNumber);

      assert.equal(attempt.validationPassed, true);
      assert.equal(attempt.executionPassed, true);
      assert.equal(attempt.corrected, false);
      assert.equal(attempt.durationMs, 42);
      assert.deepEqual(attempt.failureContext, { source: 'rerun' });

      const test = await prisma.generatedTest.findUniqueOrThrow({
        where: { id: fixture.generatedTestId },
      });
      assert.equal(test.finalStatus, 'passed');
      assert.equal(test.finalCode, EDITED_CODE);
      assert.equal(test.totalAttempts, 1);
      pass('R5 passing rerun updated final code and status to passed');
    });

    // R6 — a failing rerun records the error and keeps the edited code as final.
    await run('R6 execution failure', async () => {
      const fixture = await createFixture();
      const deps: RerunDeps = {
        validate: passingValidate(),
        execute: async () => ({
          success: false,
          results: [
            {
              testCaseId: 'tc-edit-1',
              passed: false,
              durationMs: 7,
              error: 'Error: expect(locator).toBeVisible() failed',
              failureClass: 'finding',
              failureContext: { finalUrl: MARKER, navigations: [MARKER] },
            },
          ],
        }),
      };

      const { attemptNumber } = await startTestRerun(rerunInput(fixture), deps);
      const attempt = await waitForAttempt(fixture.generatedTestId, attemptNumber);

      assert.equal(attempt.executionPassed, false);
      assert.equal(attempt.executionError, 'Error: expect(locator).toBeVisible() failed');
      assert.equal(attempt.failureClass, 'finding');
      assert.deepEqual(attempt.failureContext, {
        finalUrl: MARKER,
        navigations: [MARKER],
        source: 'rerun',
      });

      const test = await prisma.generatedTest.findUniqueOrThrow({
        where: { id: fixture.generatedTestId },
      });
      assert.equal(test.finalStatus, 'failed');
      assert.equal(test.finalCode, EDITED_CODE);
      assert.equal(test.totalAttempts, 1);
      pass('R6 failing rerun stored the error and marked the test failed');
    });

    // R7 — a second concurrent rerun of the same test is rejected, the first completes.
    await run('R7 concurrency', async () => {
      const fixture = await createFixture();
      let releaseExecute!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseExecute = resolve;
      });
      let executeCalls = 0;

      const deps: RerunDeps = {
        validate: passingValidate(),
        execute: async () => {
          executeCalls += 1;
          await gate;
          return {
            success: true,
            results: [{ testCaseId: 'tc-edit-1', passed: true, durationMs: 10 }],
          };
        },
      };

      const first = await startTestRerun(rerunInput(fixture), deps);
      await delay(100);
      await assert.rejects(
        () => startTestRerun(rerunInput(fixture), deps),
        hasCode('RERUN_IN_PROGRESS'),
      );

      releaseExecute();
      await waitForAttempt(fixture.generatedTestId, first.attemptNumber);
      await delay(100);

      assert.equal(executeCalls, 1, 'only the first rerun may execute');
      const rows = await prisma.executionResult.findMany({
        where: { generatedTestId: fixture.generatedTestId },
        orderBy: { attemptNumber: 'asc' },
      });
      assert.equal(rows.length, 1);
      assert.deepEqual(rows.map((row) => row.attemptNumber), [first.attemptNumber]);

      const test = await prisma.generatedTest.findUniqueOrThrow({
        where: { id: fixture.generatedTestId },
      });
      assert.equal(test.totalAttempts, 1);
      pass('R7 concurrent rerun rejected with RERUN_IN_PROGRESS');
    });

    // R8 — secret values reach the runner transiently and are persisted nowhere.
    //
    // NOTE: redaction of runner output happens inside the real executor; the fake
    // below returns an already-redacted error on purpose. This test asserts the
    // secrets pass-through, the token-form persistence of the code, and that the
    // job detail payload never contains the secret value.
    await run('R8 secrets pass-through', async () => {
      const fixture = await createFixture();
      const SECRET_TOKEN = '__AGT_SECRET_1__';
      const SECRET_VALUE = 'P@ssw0rd-not-persisted';
      const tokenCode = EDITED_CODE.replace(/\/Example\//, SECRET_TOKEN);

      let receivedSecret: string | undefined;
      const deps: RerunDeps = {
        validate: passingValidate(),
        execute: async (_runId, _files, options) => {
          receivedSecret = options?.secrets?.get(SECRET_TOKEN);
          return {
            success: false,
            results: [
              {
                testCaseId: 'tc-edit-1',
                passed: false,
                durationMs: 3,
                error: 'Error: expected [redacted] but the page showed something else',
                failureClass: 'finding',
              },
            ],
          };
        },
      };

      const { attemptNumber } = await startTestRerun(
        rerunInput(fixture, { code: tokenCode, secrets: { [SECRET_TOKEN]: SECRET_VALUE } }),
        deps,
      );
      const attempt = await waitForAttempt(fixture.generatedTestId, attemptNumber);

      assert.equal(receivedSecret, SECRET_VALUE, 'secret must reach the runner substitute step');
      assert.ok(attempt.code.includes(SECRET_TOKEN), 'attempt stores the token form');
      assert.ok(!attempt.code.includes(SECRET_VALUE), 'attempt code must never contain the value');
      assert.ok(
        !String(attempt.executionError).includes(SECRET_VALUE),
        'stored execution error must not contain the value',
      );

      const job = await getJobById(fixture.jobId);
      assert.ok(job);
      const detailJson = JSON.stringify(buildJobDetail(job, { viewerVisitorId: VISITOR }));
      assert.ok(!detailJson.includes(SECRET_VALUE), 'job detail payload must not contain the value');
      pass('R8 secrets passed transiently, stored as tokens only');
    });

    // R9 — end-to-end through the real validator + isolated runner (opt-in).
    if (process.env.RERUN_LIVE !== '1') {
      console.log('[SKIP] R9 live Playwright rerun (set RERUN_LIVE=1 to run)');
    } else {
      await run('R9 live validate + execute', async () => {
        const fixture = await createFixture({ testCaseId: 'rerun-live-1' });
        const liveCode = [
          "import { test, expect } from '@playwright/test';",
          '',
          "test('example.com title', async ({ page }) => {",
          "  await page.goto('https://example.com');",
          "  await expect(page).toHaveTitle(/Example/);",
          '});',
          '',
        ].join('\n');

        const { attemptNumber } = await startTestRerun(
          rerunInput(fixture, { testCaseId: 'rerun-live-1', code: liveCode }),
        );
        const attempt = await waitForAttempt(fixture.generatedTestId, attemptNumber, 180_000);

        assert.equal(attempt.validationPassed, true, `validation failed: ${String(attempt.validationErrors)}`);
        assert.equal(attempt.executionPassed, true, `execution failed: ${attempt.executionError ?? ''}`);

        const test = await prisma.generatedTest.findUniqueOrThrow({
          where: { id: fixture.generatedTestId },
        });
        assert.equal(test.finalStatus, 'passed');
        assert.equal(test.finalCode, liveCode);
        pass('R9 live rerun validated and passed end-to-end');
      });
    }
  } finally {
    const removed = await prisma.job.deleteMany({ where: { targetUrl: MARKER } });
    console.log(`\nCleanup: removed ${removed.count} rerun-test job(s).`);
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n=== ${failures} RERUN TEST(S) FAILED ===`);
    process.exitCode = 1;
  } else {
    console.log('\n=== ALL RERUN TESTS PASSED ===');
  }
}

main().catch((error) => {
  console.error('Rerun verification crashed:', error);
  process.exitCode = 1;
});
