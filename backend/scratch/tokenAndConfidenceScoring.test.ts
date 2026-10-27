import assert from 'node:assert/strict';
import { summarizeTokenUsage } from '../src/agent/tokenUsage.ts';
import { scoreTestConfidence } from '../src/agent/confidence.ts';

// --- Token usage summarization -------------------------------------------
const usage = summarizeTokenUsage([
  { llmProvider: 'groq', llmModel: 'openai/gpt-oss-120b', promptTokens: 1_000_000, completionTokens: 500_000 },
  { llmProvider: 'groq', llmModel: 'openai/gpt-oss-120b', promptTokens: null, completionTokens: null },
  { llmProvider: 'gemini', llmModel: 'gemini-2.5-flash', promptTokens: 900_000, completionTokens: 100_000 },
  { llmProvider: 'groq', llmModel: 'some-unpriced-model', promptTokens: 100, completionTokens: 100 },
  { llmProvider: null, llmModel: null, promptTokens: null, completionTokens: null },
]);
assert.equal(usage.totalTokens, 2_500_200);
assert.equal(usage.promptTokens, 1_900_100);
assert.equal(usage.completionTokens, 600_100);
assert.equal(usage.rows.length, 3);
const groqRow = usage.rows.find((row) => row.provider === 'groq' && row.model === 'openai/gpt-oss-120b');
assert.equal(groqRow?.calls, 2);
assert.equal(groqRow?.promptTokens, 1_000_000);
assert.equal(groqRow?.completionTokens, 500_000);
assert.deepEqual(summarizeTokenUsage([]), {
  totalTokens: 0,
  promptTokens: 0,
  completionTokens: 0,
  rows: [],
});
console.log('[PASS] Token usage summarization');

// --- Confidence scoring --------------------------------------------------
const strongCode = `
import { test, expect } from '@playwright/test';
test('add todo', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  const input = page.getByTestId('text-input');
  await input.fill('Buy groceries');
  await input.press('Enter');
  await expect(page.getByText('Buy groceries')).toBeVisible();
  await expect(page.getByTestId('todo-count')).toHaveText('1 item');
  await expect(page).toHaveURL(/localhost/);
});`;
const strong = scoreTestConfidence({
  code: strongCode, finalStatus: 'passed',
  attempts: [{ corrected: false, validationPassed: true, executionPassed: true }],
});
assert.ok(strong.score >= 75, `expected high confidence, got ${strong.score}`);
assert.equal(strong.band, 'high');

const weakCode = `
import { test, expect } from '@playwright/test';
test('fragile', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.locator('.btn.primary > span').click();
  await expect(page.locator('.toast')).toBeVisible();
});`;
const weak = scoreTestConfidence({
  code: weakCode, finalStatus: 'gave_up',
  attempts: [
    { corrected: false, validationPassed: true, executionPassed: false, failureClass: 'locator' },
    { corrected: true, validationPassed: true, executionPassed: false, failureClass: 'locator' },
    { corrected: true, validationPassed: false },
  ],
});
assert.ok(weak.score < 50, `expected low confidence, got ${weak.score}`);
assert.equal(weak.band, 'low');

// A finding (real app bug) must not be scored like a gave_up test.
const finding = scoreTestConfidence({
  code: strongCode, finalStatus: 'failed',
  attempts: [{ corrected: false, validationPassed: true, executionPassed: false, failureClass: 'finding' }],
});
assert.ok(finding.score > weak.score);
assert.ok(finding.factors.every((factor) => Number.isFinite(factor.points)));
console.log('[PASS] Confidence scoring');

// Batch orchestration + request schema covered in jobEventsAndDetachedRunner.test.ts.

console.log('Token Usage & Confidence Scoring verification passed.');
