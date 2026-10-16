import assert from 'node:assert/strict';
import { estimateJobCost } from '../src/agent/costEstimate.ts';
import { scoreTestConfidence } from '../src/agent/confidence.ts';
import { runBatch, MAX_BATCH_URLS } from '../src/agent/batch.ts';
import { GenerateRequestSchema } from '../src/api/schemas.ts';
import { LlmError } from '../src/llm/types.ts';
import type { PipelineResult } from '../src/agent/pipeline.ts';

// --- 6A: cost estimation -------------------------------------------------
const cost = estimateJobCost([
  { llmProvider: 'groq', llmModel: 'openai/gpt-oss-120b', promptTokens: 1_000_000, completionTokens: 500_000 },
  { llmProvider: 'groq', llmModel: 'openai/gpt-oss-120b', promptTokens: null, completionTokens: null },
  { llmProvider: 'gemini', llmModel: 'gemini-2.5-flash', promptTokens: 900_000, completionTokens: 100_000 },
  { llmProvider: 'groq', llmModel: 'some-unpriced-model', promptTokens: 100, completionTokens: 100 },
  { llmProvider: null, llmModel: null, promptTokens: null, completionTokens: null },
]);
// groq: 1M * $0.15 + 500k * $0.60 = $0.45; gemini free tier = $0; unpriced adds 0.
assert.equal(cost.totalUsd, 0.45);
assert.equal(cost.calls, 4);
assert.equal(cost.unpricedCalls, 1);
assert.equal(cost.totalTokens, 2_500_200);
const groqRow = cost.byProvider.find((row) => row.provider === 'groq');
assert.equal(groqRow?.calls, 3);
assert.equal(groqRow?.usd, 0.45);
assert.equal(groqRow?.priced, false); // one groq call used an unpriced model
assert.equal(cost.byProvider.find((row) => row.provider === 'gemini')?.usd, 0);
assert.deepEqual(estimateJobCost([]), {
  totalUsd: 0, totalPromptTokens: 0, totalCompletionTokens: 0,
  totalTokens: 0, calls: 0, unpricedCalls: 0, byProvider: [],
});
console.log('[PASS] 6A cost estimation');

// --- 6B: confidence scoring ----------------------------------------------
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
console.log('[PASS] 6B confidence scoring');

// --- 6C: batch mode --------------------------------------------------------
let active = 0;
let maxActive = 0;
const fakeResult = (jobId: string): PipelineResult => ({
  jobId,
  appMap: {} as PipelineResult['appMap'],
  testPlan: { testCases: [] },
  generatedTests: [{
    testCaseId: 'tc-1', filename: 'tc-1.spec.ts', code: 'x', status: 'passed',
    attempts: [{
      attemptNumber: 1, code: 'x', validationPassed: true,
      executionPassed: true, corrected: false,
    }],
    confidence: { score: 90, band: 'high', factors: [] },
  }],
});
const batch = await runBatch(
  ['https://a.example', 'https://b.example', 'https://a.example', 'https://bad.example', 'https://c.example'],
  async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    if (url === 'https://bad.example') throw new LlmError('ALL_PROVIDERS_FAILED', 'all down');
    return fakeResult(`job-${url}`);
  },
);
assert.equal(batch.summary.total, 4); // duplicate URL ran once
assert.equal(batch.summary.succeeded, 3);
assert.equal(batch.summary.failed, 1);
assert.ok(maxActive <= 2, `concurrency cap violated: ${maxActive}`);
assert.deepEqual(
  batch.results.map((result) => result.url),
  ['https://a.example', 'https://b.example', 'https://bad.example', 'https://c.example'],
);
const failed = batch.results[2];
assert.equal(failed?.status, 'failed');
if (failed?.status === 'failed') assert.equal(failed.error.error, 'ALL_PROVIDERS_FAILED');
const first = batch.results[0];
assert.equal(first?.status, 'completed');
if (first?.status === 'completed') {
  assert.equal(first.passedCount, 1);
  assert.equal(first.generatedTests[0]?.confidence, 90);
}
console.log('[PASS] 6C batch orchestration (settled, ordered, deduped, concurrency <= 2)');

// --- 6C: request schema ----------------------------------------------------
assert.equal(GenerateRequestSchema.safeParse({ url: 'https://x.example' }).success, true);
assert.equal(GenerateRequestSchema.safeParse({ urls: ['https://x.example'] }).success, true);
assert.equal(GenerateRequestSchema.safeParse({ url: 'https://x.example', urls: ['https://y.example'] }).success, false);
assert.equal(GenerateRequestSchema.safeParse({ urls: [] }).success, false);
assert.equal(
  GenerateRequestSchema.safeParse({ urls: Array.from({ length: MAX_BATCH_URLS + 1 }, (_, i) => `https://x${i}.example`) }).success,
  false,
);
console.log('[PASS] 6C request schema');

console.log('Phase 6 verification passed.');
