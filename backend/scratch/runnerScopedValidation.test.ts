import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { validateTestCode } from '../src/runner/validator.ts';
import { executeTests } from '../src/runner/executor.ts';
import { RUNNER_DIR, RUNNER_TESTS_DIR } from '../src/runner/config.ts';
import { stopEgressProxy } from '../src/security/egressProxy.ts';

async function verify(): Promise<void> {
  try {
    const runIds = [`run-${randomUUID()}`, `run-${randomUUID()}`];
    const files = [1, 2].map((number) => ({
      filename: 'tc-1.spec.ts',
      code: `import { test, expect } from '@playwright/test';
        test('isolated ${number}', async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
          expect(${number}).toBe(${number});
        });`,
    }));
    const validations = await Promise.all(runIds.map((id, i) => validateTestCode(id, [files[i]])));
    assert.ok(validations.every((result) => result.valid), JSON.stringify(validations));
    const results = await Promise.all(runIds.map((id, i) => executeTests(id, [files[i]])));
    for (const result of results) {
      assert.equal(result.success, true, JSON.stringify(result));
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0]?.testCaseId, 'tc-1');
    }
    for (const id of runIds) {
      await assert.rejects(access(path.join(RUNNER_TESTS_DIR, id)));
      await assert.rejects(access(path.join(RUNNER_DIR, `tsconfig.${id}.json`)));
    }
    console.log('[PASS] concurrent scoped validation, execution, and cleanup (no browser fixture required)');
  } finally {
    await stopEgressProxy();
  }
}

verify()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
