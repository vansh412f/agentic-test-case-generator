import { selfCheck } from '../runner/isolation.ts';
import { executeTests } from '../runner/executor.ts';

async function main(): Promise<void> {
  console.log('--- Runner Sandbox Smoke Test ---');

  // Step 1: Self check
  console.log('Step 1: Running isolation selfCheck()...');
  const checkOk = await selfCheck();
  if (!checkOk) {
    console.error('Step 1: FAIL — runner isolation selfCheck failed');
    process.exit(1);
  }
  console.log('Step 1: PASS — runner isolation verified');

  // Step 2: Passing spec
  console.log('Step 2: Executing benign test spec...');
  const benignSpec = `
import { test, expect } from '@playwright/test';

test('example page loads', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
`;
  const benignResult = await executeTests('smoke-benign-' + Date.now(), [
    { filename: 'benign.spec.ts', code: benignSpec },
  ]);

  if (!benignResult.success) {
    console.error('Step 2: FAIL — benign spec failed to pass:');
    console.error(JSON.stringify(benignResult, null, 2));
    process.exit(1);
  }
  console.log('Step 2: PASS — benign spec succeeded');

  // Step 3: Hostile spec that bypasses codeSafety (calling executor directly)
  console.log('Step 3: Executing hostile containment spec...');
  const hostileSpec = `
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('hostile sandbox escape attempts must fail', async ({ page }) => {
  // 1. readFileSync('/proc/1/environ') must fail
  let readProc1Failed = false;
  try {
    fs.readFileSync('/proc/1/environ');
  } catch {
    readProc1Failed = true;
  }
  expect(readProc1Failed).toBe(true);

  // 2. readFileSync('/proc/' + process.ppid + '/environ') must fail
  let readProcPpidFailed = false;
  try {
    fs.readFileSync('/proc/' + process.ppid + '/environ');
  } catch {
    readProcPpidFailed = true;
  }
  expect(readProcPpidFailed).toBe(true);

  // 3. writeFileSync('/app/playwright-runner/agt-capture.ts', 'x') must fail
  let writeProtectedFailed = false;
  try {
    fs.writeFileSync('/app/playwright-runner/agt-capture.ts', 'x');
  } catch {
    writeProtectedFailed = true;
  }
  expect(writeProtectedFailed).toBe(true);

  // 4. page.goto('file:///etc/passwd') must fail
  let gotoFileFailed = false;
  try {
    await page.goto('file:///etc/passwd');
  } catch {
    gotoFileFailed = true;
  }
  expect(gotoFileFailed).toBe(true);
});
`;

  const hostileResult = await executeTests('smoke-hostile-' + Date.now(), [
    { filename: 'hostile.spec.ts', code: hostileSpec },
  ]);

  if (!hostileResult.success) {
    console.error('Step 3: FAIL — hostile spec assertions failed or did not pass cleanly:');
    console.error(JSON.stringify(hostileResult, null, 2));
    process.exit(1);
  }
  console.log('Step 3: PASS — all hostile escape attempts were confined and failed as expected');

  console.log('All sandbox smoke steps PASSED.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error during sandbox smoke:', err);
  process.exit(1);
});
