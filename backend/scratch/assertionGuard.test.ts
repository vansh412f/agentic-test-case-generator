import assert from 'node:assert/strict';
import { correctionPreservesAssertions } from '../src/agent/assertionGuard.ts';

const original = `import { test, expect } from '@playwright/test';
test('example', async ({ page }) => {
  await page.goto('http://localhost:4000');
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('result')).toBeVisible();
  await expect(page.getByTestId('count')).toHaveText('3');
  expect(3).toBe(3);
});`;
const validOriginal = original.replace('  expect(3)', '  await expect(3)');

assert.equal(correctionPreservesAssertions(validOriginal, validOriginal), true);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace("getByTestId('result')", "getByRole('status')")), true);
assert.equal(correctionPreservesAssertions(original, validOriginal), true);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace('toBeVisible()', 'toBeHidden()')), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace("toHaveText('3')", "toHaveText('4')")), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace('toBe(3)', 'toBe(4)')), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace('toBeVisible()', 'not.toBeVisible()')), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace('toBeVisible()', 'toBeVisible().catch(() => {})')), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace("test('example'", "test.skip('example'")), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace('  await expect(3).toBe(3);', '')), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace('  await expect(3)', '  expect(3)')), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace("  await page.goto", "  return;\n  await page.goto")), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace("  await page.getByTestId('submit').click();",
    "  await page.waitForLoadState('domcontentloaded');\n  await page.getByTestId('submit').click();")), true);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace("page.getByTestId('result')", "true")), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace("  await page.goto", "  try {\n  await page.goto").replace("\n});", "\n  } catch {}\n});")), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace("getByTestId('result')", "getByTestId((() => 'result')())")), false);
assert.equal(correctionPreservesAssertions(validOriginal,
  validOriginal.replace("  await page.getByTestId('submit').click();",
    "  await page.waitForSelector((() => '#result')());\n  await page.getByTestId('submit').click();")), false);
const textAssertion = validOriginal.replace("getByTestId('result')", "getByText('Expected result')");
assert.equal(correctionPreservesAssertions(textAssertion,
  textAssertion.replace("getByText('Expected result')", "getByText('Different result')")), false);
const indirectText = textAssertion.replace("  await expect(page.getByText('Expected result'))",
  "  const result = page.getByText('Expected result');\n  await expect(result)");
assert.equal(correctionPreservesAssertions(indirectText,
  indirectText.replace("getByText('Expected result')", "getByText('Different result')")), false);
const indirectExpected = validOriginal.replace("  await expect(3).toBe(3);",
  "  const expected = 3;\n  await expect(3).toBe(expected);");
assert.equal(correctionPreservesAssertions(indirectExpected,
  indirectExpected.replace('const expected = 3', 'const expected = 4')), false);
console.log('[PASS] assertion guard regression checks');
