import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import type { AppMap, InteractiveElement, AppForm } from '../src/crawler/types.ts';
import { validateAndNormalizePlan } from '../src/agent/steps/planner.ts';
import { rememberCrawl, takeFreshCrawl, clearCrawlCache } from '../src/crawler/crawlCache.ts';
import { findUnsafeConstructs } from '../src/runner/codeSafety.ts';
import { playwrightRunnerEnv } from '../src/runner/childEnv.ts';
import { webhookUrlProblem, signWebhookBody, deliverJobWebhook } from '../src/notify/webhook.ts';
import { GenerateRequestSchema } from '../src/api/schemas.ts';
import { config } from '../src/config.ts';

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

function createDummyAppMap(url: string, elements: InteractiveElement[] = [], forms: AppForm[] = []): AppMap {
  return {
    url,
    title: `Title for ${url}`,
    crawledAt: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    elements,
    forms,
    discoveredLinks: [],
    totalElementsFound: elements.length,
    isTruncated: false,
  };
}

async function runTests() {
  console.log('--- 1. validateAndNormalizePlan ---');
  {
    const knownIds = new Set(['elem-1']);
    const validPlan = JSON.stringify({
      testCases: [
        {
          id: 'tc-1',
          title: 'Basic plan',
          description: 'Testing element',
          steps: [
            { action: 'click', elementId: 'elem-1', value: null, description: 'click elem' },
          ],
        },
      ],
    });
    const res = validateAndNormalizePlan(validPlan, knownIds, 'https://example.com/');
    assert.equal(res.ok, true);
  }

  console.log('--- 4. crawlCache ---');
  {
    clearCrawlCache();
    const map = createDummyAppMap('https://example.com/page/');
    rememberCrawl('https://example.com/page#section', map);

    // Hit via hash and trailing slash normalisation
    const hit1 = takeFreshCrawl('https://example.com/page');
    assert.ok(hit1 !== null);
    assert.equal(hit1.url, map.url);

    // Hit via final URL
    const hit2 = takeFreshCrawl('https://example.com/page/');
    assert.ok(hit2 !== null);

    // Mutating returned map doesn't affect cache
    hit1.title = 'Mutated Title';
    const hit3 = takeFreshCrawl('https://example.com/page');
    assert.equal(hit3?.title, map.title);

    // 25 inserts evict the oldest
    for (let i = 0; i < 25; i++) {
      rememberCrawl(`https://example.com/item-${i}`, createDummyAppMap(`https://example.com/item-${i}`));
    }
    const evicted = takeFreshCrawl('https://example.com/page');
    assert.equal(evicted, null, 'Oldest entry should be evicted');
  }

  console.log('--- 5. findUnsafeConstructs ---');
  {
    const cleanSpec = `
      import { test, expect } from '@playwright/test';
      test('clean test', async ({ page }) => {
        const o = { process: 1 };
        const p = o.process;
        await expect(page.locator('button')).toBeVisible();
      });
    `;
    assert.deepEqual(findUnsafeConstructs(cleanSpec), []);

    assert.ok(findUnsafeConstructs(`import 'node:fs';`).length > 0);
    assert.ok(findUnsafeConstructs(`const fs = require('fs');`).length > 0);
    assert.ok(findUnsafeConstructs(`const k = process.env.KEY;`).length > 0);
    assert.ok(findUnsafeConstructs(`const mod = import('node:net');`).length > 0);
    assert.ok(findUnsafeConstructs(`const u = 'file:///etc/passwd';`).length > 0);
    assert.ok(findUnsafeConstructs('const x = 1; const u = `file:///${x}`;').length > 0);
    assert.ok(findUnsafeConstructs(`const fn = new Function('return 1');`).length > 0);
  }

  console.log('--- 6. playwrightRunnerEnv ---');
  {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.GROQ_API_KEY = 'gsk_test123';

    const env = playwrightRunnerEnv('scratch/test-results.json');
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.GROQ_API_KEY, undefined);
    assert.equal(env.PLAYWRIGHT_JSON_OUTPUT_FILE, 'scratch/test-results.json');
    assert.equal(env.HEADLESS, 'true');
  }

  console.log('--- 7. webhookUrlProblem & signWebhookBody ---');
  {
    // Accepts public https URL
    assert.equal(webhookUrlProblem('https://api.example.com/webhook'), null);

    // Rejects
    assert.ok(webhookUrlProblem('http://api.example.com/webhook') !== null);
    assert.ok(webhookUrlProblem('https://localhost/webhook') !== null);
    assert.ok(webhookUrlProblem('https://127.0.0.1/webhook') !== null);
    assert.ok(webhookUrlProblem('https://10.0.0.1/webhook') !== null);
    assert.ok(webhookUrlProblem('https://169.254.169.254/latest/meta-data') !== null);
    assert.ok(webhookUrlProblem('https://[::1]/webhook') !== null);
    assert.ok(webhookUrlProblem('https://[::ffff:10.0.0.1]/webhook') !== null);
    assert.ok(webhookUrlProblem('https://user:pass@api.example.com/webhook') !== null);
    assert.ok(webhookUrlProblem('https://myhost.internal/webhook') !== null);

    // signWebhookBody matches createHmac
    const secret = 'test-secret-key-123';
    const body = JSON.stringify({ hello: 'world' });
    const expectedSig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    assert.equal(signWebhookBody(secret, body), expectedSig);
  }

  console.log('--- 8. GenerateRequestSchema ---');
  {
    // url + deepCrawl stripped + webhookUrl ok
    const res1 = GenerateRequestSchema.safeParse({
      url: 'https://example.com',
      deepCrawl: true,
      webhookUrl: 'https://api.example.com/webhook',
    });
    assert.equal(res1.success, true);
    if (res1.success) {
      assert.equal('deepCrawl' in res1.data, false);
    }

    // urls + deepCrawl stripped ok
    const res2 = GenerateRequestSchema.safeParse({
      urls: ['https://example.com'],
      deepCrawl: true,
    });
    assert.equal(res2.success, true);
    if (res2.success) {
      assert.equal('deepCrawl' in res2.data, false);
    }

    // bad webhookUrl rejected
    const res3 = GenerateRequestSchema.safeParse({
      url: 'https://example.com',
      webhookUrl: 'not-a-valid-url',
    });
    assert.equal(res3.success, false);
  }

  console.log('--- 9. deliverJobWebhook to 127.0.0.1 ---');
  {
    let serverHits = 0;
    const server = http.createServer((_req, res) => {
      serverHits++;
      res.writeHead(200);
      res.end('ok');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;

    try {
      await deliverJobWebhook(
        { url: `http://127.0.0.1:${port}/webhook`, secret: 'sec' },
        {
          event: 'job.finished',
          jobId: '00000000-0000-0000-0000-000000000000',
          targetUrl: 'https://example.com',
          finishedAt: new Date().toISOString(),
          status: 'completed',
          tests: { total: 1, passed: 1, failed: 0, gaveUp: 0 },
        },
      );
      assert.equal(serverHits, 0, 'Localhost webhook should be blocked when LOCAL_AGENT_MODE is false');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  console.log('All testPhase11 assertions passed!');
}

runTests().catch((err) => {
  console.error('testPhase11 failed:', err);
  process.exit(1);
});
