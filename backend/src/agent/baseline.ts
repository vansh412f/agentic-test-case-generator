import type { AppMap } from '../crawler/types.ts';
import type { TestCase, PlanStep } from './prompts/plannerPrompt.ts';
import { config } from '../config.ts';

const SKIP_PATH = /(log-?out|sign-?out|delete|unsubscribe|\.(pdf|zip|gz|dmg|exe|png|jpe?g|gif|svg|webp|mp4|mp3|csv|xlsx?|docx?))$/i;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface BaselineTest {
  testCase: TestCase;
  filename: string;
  code: string;
}

export function buildBaselineTests(appMap: AppMap): BaselineTest[] {
  if (!config.BASELINE_TESTS) {
    return [];
  }

  const baselineTests: BaselineTest[] = [];

  // smoke-1: Page loads without uncaught JavaScript errors
  const escapedTitle = escapeRegex(appMap.title?.trim() ?? '');
  const titleAssertion = escapedTitle.length > 0
    ? `  await expect(page).toHaveTitle(new RegExp(${JSON.stringify(escapedTitle)}));\n`
    : '';

  const smoke1Code = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test('Page loads without uncaught JavaScript errors', async ({ page }) => {`,
    `  const errors: string[] = [];`,
    `  page.on('pageerror', (e) => errors.push(e.message));`,
    `  const response = await page.goto(${JSON.stringify(appMap.url)});`,
    `  expect(response?.status() ?? 0).toBeLessThan(400);`,
    titleAssertion ? titleAssertion.trimEnd() : undefined,
    `  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);`,
    `  expect(errors).toEqual([]);`,
    `});`,
    '',
  ].filter((line): line is string => line !== undefined).join('\n');

  const smoke1Steps: PlanStep[] = [
    {
      action: 'navigate',
      elementId: null,
      target: null,
      value: appMap.url,
      description: `Navigate to ${appMap.url}`,
    },
    {
      action: 'assert_title',
      elementId: null,
      target: null,
      value: appMap.title?.trim() || '.*',
      description: 'Assert page title matches crawled title with no uncaught errors',
    },
  ];

  baselineTests.push({
    testCase: {
      id: 'smoke-1',
      title: 'Page loads without uncaught JavaScript errors',
      description: 'Baseline check: navigates to page, verifies HTTP < 400, title, and no uncaught JS errors.',
      steps: smoke1Steps,
      origin: 'baseline',
    },
    filename: 'smoke-1.spec.ts',
    code: smoke1Code,
  });

  // smoke-2: Linked pages respond without errors
  let origin = '';
  try {
    origin = new URL(appMap.url).origin;
  } catch {}

  const sameOriginLinks: string[] = [];
  const seenLinks = new Set<string>();
  try {
    const cleanBase = new URL(appMap.url).href.replace(/\/$/, '');
    seenLinks.add(cleanBase);
  } catch {}

  for (const rawLink of appMap.discoveredLinks ?? []) {
    try {
      const u = new URL(rawLink, appMap.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      if (u.origin !== origin) continue;
      if (SKIP_PATH.test(u.pathname)) continue;
      const cleanHref = u.href.replace(/\/$/, '');
      if (seenLinks.has(cleanHref)) continue;
      seenLinks.add(cleanHref);
      sameOriginLinks.push(u.href);
      if (sameOriginLinks.length >= 8) break;
    } catch {}
  }

  if (sameOriginLinks.length >= 1) {
    const smoke2Code = [
      `import { test, expect } from '@playwright/test';`,
      '',
      `test('Linked pages respond without errors', async ({ page }) => {`,
      `  test.setTimeout(90_000);`,
      `  const links = ${JSON.stringify(sameOriginLinks, null, 2)};`,
      `  const broken: string[] = [];`,
      `  for (const url of links) {`,
      `    try {`,
      `      const response = await page.request.get(url, { maxRedirects: 5, timeout: 10_000 });`,
      `      const status = response.status();`,
      `      if (status >= 400 && status !== 401 && status !== 403) {`,
      `        broken.push(\`\${status} \${url}\`);`,
      `      }`,
      `    } catch (err) {`,
      `      broken.push(\`ERR \${url}: \${err instanceof Error ? err.message : String(err)}\`);`,
      `    }`,
      `  }`,
      `  expect(broken).toEqual([]);`,
      `});`,
      '',
    ].join('\n');

    const smoke2Steps: PlanStep[] = sameOriginLinks.map((link) => ({
      action: 'navigate',
      elementId: null,
      target: null,
      value: link,
      description: `Verify linked page responds: ${link}`,
    }));

    baselineTests.push({
      testCase: {
        id: 'smoke-2',
        title: 'Linked pages respond without errors',
        description: `Baseline check: verifies up to 8 same-origin links are reachable (broken only on 404/410/5xx/network errors; 401/403 count as reachable).`,
        steps: smoke2Steps,
        origin: 'baseline',
      },
      filename: 'smoke-2.spec.ts',
      code: smoke2Code,
    });
  }

  return baselineTests;
}
