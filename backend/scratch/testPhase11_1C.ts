import assert from 'node:assert/strict';
import { runRounds, type RoundTest, pushAttempt } from '../src/agent/rounds.ts';
import type { TestCase } from '../src/agent/prompts/plannerPrompt.ts';

function createDummyTestCase(id: string, title = `Test Case ${id}`): TestCase {
  return {
    id,
    title,
    description: `Description for ${id}`,
    category: 'critical_path',
    priority: 'high',
    steps: [],
    assertions: [],
  };
}

function createDummyRoundTest(
  id: string,
  code: string,
  origin: 'compiled' | 'llm' | 'baseline' | 'corrected' = 'llm',
): RoundTest {
  return {
    testCase: createDummyTestCase(id),
    filename: `${id}.spec.ts`,
    code,
    codeVersion: 1,
    validatedVersion: 0,
    origin,
    elementsInScope: [],
    attempts: [],
    priorErrors: [],
    status: 'open',
    recorded: false,
  };
}

async function testTscFailCorrectedNextRoundExec() {
  console.log('--- Test 1: tsc-fail -> corrected -> next round tsc -> exec ---');
  const test1 = createDummyRoundTest('tc-1', 'const bad: number = "bad";', 'llm');
  const executedFilesPerRound: Array<Array<{ filename: string; code: string }>> = [];
  const validatedFilesPerRound: Array<Array<{ filename: string; code: string }>> = [];

  let roundCounter = 0;
  await runRounds([test1], {
    checkSafety: () => [],
    validateBatch: async (files) => {
      roundCounter++;
      validatedFilesPerRound.push([...files]);
      const perFile = new Map<string, string[]>();
      for (const f of files) {
        if (f.code.includes('bad')) {
          perFile.set(f.filename, ['Type string is not assignable to type number']);
        } else {
          perFile.set(f.filename, []);
        }
      }
      return { perFile, batchLatencyMs: 10 };
    },
    executeBatch: async (files) => {
      executedFilesPerRound.push([...files]);
      return {
        success: true,
        results: files.map((f) => ({
          testCaseId: f.filename.replace(/\.spec\.ts$/, ''),
          passed: true,
          durationMs: 50,
        })),
      };
    },
    correct: async ({ test, errorText }) => {
      assert.ok(errorText.includes('Type string'));
      return { code: 'const good: number = 42;' };
    },
  });

  // Round 1 validated bad code -> failed -> corrected to good code.
  // In round 1 execution, tc-1 should NOT have been executed!
  assert.equal(executedFilesPerRound.length, 1, 'executeBatch should only be called in round 2');
  assert.equal(executedFilesPerRound[0][0].filename, 'tc-1.spec.ts');
  assert.equal(executedFilesPerRound[0][0].code, 'const good: number = 42;');

  // Assert round 1 validated the bad code, and round 2 validated the good code before executing
  assert.equal(validatedFilesPerRound.length, 2, 'Should validate twice (round 1 bad, round 2 good)');
  assert.ok(validatedFilesPerRound[0][0].code.includes('bad'));
  assert.ok(validatedFilesPerRound[1][0].code.includes('good'));

  assert.equal(test1.status, 'passed');
  assert.equal(test1.attempts.length, 2);
  assert.equal(test1.attempts[0].validationPassed, false);
  assert.equal(test1.attempts[0].attemptNumber, 1);
  assert.equal(test1.attempts[1].validationPassed, true);
  assert.equal(test1.attempts[1].executionPassed, true);
  assert.equal(test1.attempts[1].attemptNumber, 2);
  console.log('✓ Test 1 passed\n');
}

async function testAttemptNumbersStrictlyIncreasingNoDuplicates() {
  console.log('--- Test 2: attemptNumbers strictly 1..n with no duplicates across all paths ---');
  // Paths to test:
  // Test A: unsafe construct -> corrected -> tsc fail -> corrected -> exec fail -> corrected -> exec pass
  const testA = createDummyRoundTest('tc-a', 'eval("unsafe")', 'llm');
  let correctCallCount = 0;

  await runRounds([testA], {
    checkSafety: (code) => {
      if (code.includes('eval')) return ['Forbidden identifier: eval'];
      return [];
    },
    validateBatch: async (files) => {
      const perFile = new Map<string, string[]>();
      for (const f of files) {
        if (f.code.includes('bad_type')) {
          perFile.set(f.filename, ['Syntax error: bad_type']);
        } else {
          perFile.set(f.filename, []);
        }
      }
      return { perFile, batchLatencyMs: 5 };
    },
    executeBatch: async (files) => {
      return {
        success: false,
        results: files.map((f) => ({
          testCaseId: f.filename.replace(/\.spec\.ts$/, ''),
          passed: f.code.includes('perfect'),
          durationMs: 25,
          error: f.code.includes('perfect') ? undefined : 'Assertion mismatch: expected 1 to be 2',
          failureClass: f.code.includes('perfect') ? undefined : ('timeout' as const),
        })),
      };
    },
    correct: async () => {
      correctCallCount++;
      if (correctCallCount === 1) return { code: 'const x: bad_type = 1;' };
      if (correctCallCount === 2) return { code: 'const x: number = 1; // fails execution' };
      return { code: 'const perfect = true;' };
    },
  });

  const attempts = testA.attempts;
  assert.ok(attempts.length >= 3, `Expected at least 3 attempts, got ${attempts.length}`);
  for (let i = 0; i < attempts.length; i++) {
    assert.equal(attempts[i].attemptNumber, i + 1, `Attempt index ${i} should have attemptNumber ${i + 1}`);
  }

  // Ensure no duplicate attemptNumbers
  const attemptNumbers = attempts.map((a) => a.attemptNumber);
  const uniqueNumbers = new Set(attemptNumbers);
  assert.equal(attemptNumbers.length, uniqueNumbers.size, 'attemptNumbers must have no duplicates');
  console.log('✓ Test 2 passed\n');
}

async function testMissingResultAttribution() {
  console.log('--- Test 3: missing result -> failed attribution only to that test (B20) ---');
  const testA = createDummyRoundTest('tc-a', 'codeA', 'compiled');
  const testB = createDummyRoundTest('tc-b', 'codeB', 'compiled');

  await runRounds([testA, testB], {
    checkSafety: () => [],
    validateBatch: async () => ({ perFile: new Map(), batchLatencyMs: 0 }),
    executeBatch: async () => {
      // Playwright reported ONLY tc-a, tc-b was omitted/crashed
      return {
        success: true,
        results: [
          {
            testCaseId: 'tc-a',
            passed: true,
            durationMs: 100,
          },
        ],
      };
    },
    correct: async () => null, // reject correction so it terminates
  });

  assert.equal(testA.status, 'passed');
  assert.equal(testA.attempts[0].executionPassed, true);

  assert.equal(testB.status, 'gave_up');
  assert.equal(testB.attempts[0].executionPassed, false);
  assert.equal(testB.attempts[0].failureClass, 'other');
  assert.equal(testB.attempts[0].executionError, 'Test case was not reported by Playwright');
  console.log('✓ Test 3 passed\n');
}

async function testCanCorrectFalseTokenBudget() {
  console.log('--- Test 4: canCorrect=false path (token budget / cap reached) ---');
  const testA = createDummyRoundTest('tc-budget', 'const x: bad = 1;', 'llm');
  let correctCalled = false;

  await runRounds([testA], {
    checkSafety: () => [],
    validateBatch: async (files) => {
      const perFile = new Map<string, string[]>();
      perFile.set('tc-budget.spec.ts', ['Type error']);
      return { perFile, batchLatencyMs: 5 };
    },
    executeBatch: async () => ({ success: true, results: [] }),
    canCorrect: () => false, // token budget reached
    correct: async () => {
      correctCalled = true;
      return { code: 'const x = 1;' };
    },
  });

  assert.equal(correctCalled, false, 'correct() should not be called when canCorrect is false');
  assert.equal(testA.status, 'gave_up');
  assert.equal(testA.attempts.length, 1);
  assert.equal(testA.attempts[0].gaveUpReason, 'token_budget');
  assert.ok(testA.attempts[0].executionError?.includes('[gaveUpReason: token_budget]'));
  console.log('✓ Test 4 passed\n');
}

async function testSafeWritePersistenceResilience() {
  console.log('--- Test 5: safeWrite resilience (P2002 non-transient, P1001 transient, critical bypass) ---');
  const { safeWrite, withPersistence, isBreakerOpen } = await import('../src/db/safeWrite.ts');

  // A. P2002 error does NOT trip the breaker
  await withPersistence(async () => {
    assert.equal(isBreakerOpen(), false);

    const nonTransientErr = new Error('Unique constraint failed on the fields: (`attemptNumber`)');
    (nonTransientErr as unknown as { code: string }).code = 'P2002';

    const res1 = await safeWrite('testP2002', async () => {
      throw nonTransientErr;
    });
    assert.equal(res1, undefined);
    assert.equal(isBreakerOpen(), false, 'P2002 must NOT trip the breaker');

    // Subsequent normal write still works
    const res2 = await safeWrite('testOk', async () => 'write_success');
    assert.equal(res2, 'write_success');
    assert.equal(isBreakerOpen(), false);
  });

  // B. P1001 error (transient) retries once and then trips the breaker
  await withPersistence(async () => {
    assert.equal(isBreakerOpen(), false);

    let attempts = 0;
    const transientErr = new Error("Can't reach database server at `aws-0-ap-southeast-1.pooler.supabase.com`");
    (transientErr as unknown as { code: string }).code = 'P1001';

    const res1 = await safeWrite('testP1001', async () => {
      attempts++;
      throw transientErr;
    });
    assert.equal(res1, undefined);
    assert.equal(attempts, 2, 'P1001 must retry once after 500ms (2 attempts total)');
    assert.equal(isBreakerOpen(), true, 'P1001 must trip the breaker after retry fails');

    // Subsequent non-critical write is skipped
    let nonCriticalRan = false;
    const res2 = await safeWrite('testSkipped', async () => {
      nonCriticalRan = true;
      return 123;
    });
    assert.equal(res2, undefined);
    assert.equal(nonCriticalRan, false, 'Non-critical write must be skipped when breaker is open');

    // C. Critical operation bypasses the tripped breaker and succeeds
    let criticalRan = false;
    const res3 = await safeWrite(
      'completeJob',
      async () => {
        criticalRan = true;
        return { completed: true };
      },
      { critical: true },
    );
    assert.equal(criticalRan, true, 'Critical write must run even when breaker is open');
    assert.deepEqual(res3, { completed: true });
  });

  console.log('✓ Test 5 passed\n');
}

async function main() {
  console.log('====================================================');
  console.log('    Phase 11.1C Regression Tests - WP1 & WP2        ');
  console.log('====================================================\n');
  await testTscFailCorrectedNextRoundExec();
  await testAttemptNumbersStrictlyIncreasingNoDuplicates();
  await testMissingResultAttribution();
  await testCanCorrectFalseTokenBudget();
  await testSafeWritePersistenceResilience();
  console.log('All WP1 & WP2 tests passed successfully!');
}

main().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
