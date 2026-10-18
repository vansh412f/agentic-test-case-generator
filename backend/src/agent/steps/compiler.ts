import type { TestCase } from '../prompts/plannerPrompt.ts';
import type { ScopedElement } from '../types.ts';
import type { GeneratedTest } from './generator.ts';

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompileError';
  }
}

const PRIORITY = ['getByTestId', 'getByRole', 'getByPlaceholder', 'getByLabel', 'getByText'] as const;
const SAFE = /^getBy(TestId|Role|Placeholder|Label|Text)\(/;

export function locatorFor(el: ScopedElement): string {
  for (const key of PRIORITY) {
    const expr = el.selectors[key];
    if (expr && SAFE.test(expr)) {
      return `page.${expr}`;
    }
  }
  return `page.locator(${JSON.stringify(el.selectors.css)})`;
}

const q = (v: string): string => JSON.stringify(v);

export function compileTest(
  testCase: TestCase,
  elementsInScope: ScopedElement[],
  targetUrl: string,
): GeneratedTest {
  const elementsMap = new Map<string, ScopedElement>(
    elementsInScope.map((e) => [e.id, e]),
  );

  const getLocator = (elementId: string | null): string => {
    if (!elementId) {
      throw new CompileError(`Step requires elementId, but received null/undefined`);
    }
    const el = elementsMap.get(elementId);
    if (!el) {
      throw new CompileError(`Unknown elementId "${elementId}" in test case "${testCase.id}"`);
    }
    return locatorFor(el);
  };

  const lines: string[] = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${q(testCase.title)}, async ({ page }) => {`,
    `  await page.goto(${q(targetUrl)});`,
  ];

  for (const step of testCase.steps) {
    switch (step.action) {
      case 'click': {
        const L = getLocator(step.elementId);
        lines.push(`  await ${L}.click();`);
        break;
      }
      case 'fill': {
        const L = getLocator(step.elementId);
        lines.push(`  await ${L}.fill(${q(step.value ?? '')});`);
        break;
      }
      case 'select': {
        const L = getLocator(step.elementId);
        lines.push(`  await ${L}.selectOption(${q(step.value ?? '')});`);
        break;
      }
      case 'hover': {
        const L = getLocator(step.elementId);
        lines.push(`  await ${L}.hover();`);
        break;
      }
      case 'press': {
        const L = getLocator(step.elementId);
        lines.push(`  await ${L}.press(${q(step.value ?? '')});`);
        break;
      }
      case 'navigate': {
        lines.push(`  await page.goto(${q(step.value ?? '')});`);
        break;
      }
      case 'assert_visible': {
        if (step.elementId) {
          const L = getLocator(step.elementId);
          lines.push(`  await expect(${L}).toBeVisible();`);
        } else {
          lines.push(`  await expect(page.getByText(${q(step.value ?? '')})).toBeVisible();`);
        }
        break;
      }
      case 'assert_text': {
        const L = getLocator(step.elementId);
        lines.push(`  await expect(${L}).toContainText(${q(step.value ?? '')});`);
        break;
      }
      case 'assert_url': {
        lines.push(`  await expect(page).toHaveURL(url => url.href.includes(${q(step.value ?? '')}));`);
        break;
      }
      default: {
        step.action satisfies never;
        throw new CompileError(`Unknown step action in test case "${testCase.id}"`);
      }
    }
  }

  lines.push('});\n');

  const filename = `${testCase.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.spec.ts`;

  return {
    filename,
    code: lines.join('\n'),
    testCaseId: testCase.id,
  };
}
