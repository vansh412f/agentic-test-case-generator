import type { TestCase, PlanStep, PlanStepTarget } from '../prompts/plannerPrompt.ts';
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function locatorForTarget(target: PlanStepTarget): string {
  const roleArg = q(target.role);
  const nameArg = target.name !== undefined ? `, { name: ${q(target.name)} }` : '';
  const roleCall = `getByRole(${roleArg}${nameArg})`;

  if (target.container && target.withinText) {
    return `page.getByRole(${q(target.container)}).filter({ hasText: ${q(target.withinText)} }).${roleCall}`;
  }
  if (target.withinText) {
    return `page.${roleCall}.filter({ hasText: ${q(target.withinText)} })`;
  }
  return `page.${roleCall}`;
}

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

  const resolveLocator = (step: PlanStep): string => {
    if (step.target) {
      return locatorForTarget(step.target);
    }
    if (step.elementId) {
      return getLocator(step.elementId);
    }
    throw new CompileError(`Step requires elementId or target`);
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
        const L = (!step.elementId && !step.target && step.value)
          ? `page.getByText(${q(step.value)}, { exact: true })`
          : resolveLocator(step);
        lines.push(`  await ${L}.click();`);
        break;
      }
      case 'dblclick': {
        const L = (!step.elementId && !step.target && step.value)
          ? `page.getByText(${q(step.value)}, { exact: true })`
          : resolveLocator(step);
        lines.push(`  await ${L}.dblclick();`);
        break;
      }
      case 'hover': {
        const L = (!step.elementId && !step.target && step.value)
          ? `page.getByText(${q(step.value)}, { exact: true })`
          : resolveLocator(step);
        lines.push(`  await ${L}.hover();`);
        break;
      }
      case 'check': {
        const L = resolveLocator(step);
        lines.push(`  await ${L}.check();`);
        break;
      }
      case 'uncheck': {
        const L = resolveLocator(step);
        lines.push(`  await ${L}.uncheck();`);
        break;
      }
      case 'reload': {
        lines.push(`  await page.reload();`);
        break;
      }
      case 'go_back': {
        lines.push(`  await page.goBack();`);
        break;
      }
      case 'fill': {
        const L = resolveLocator(step);
        lines.push(`  await ${L}.fill(${q(step.value ?? '')});`);
        break;
      }
      case 'select': {
        const L = resolveLocator(step);
        lines.push(`  await ${L}.selectOption(${q(step.value ?? '')});`);
        break;
      }
      case 'press': {
        const L = resolveLocator(step);
        lines.push(`  await ${L}.press(${q(step.value ?? '')});`);
        break;
      }
      case 'navigate': {
        lines.push(`  await page.goto(${q(step.value ?? '')});`);
        break;
      }
      case 'assert_visible': {
        if (step.target || step.elementId) {
          const L = resolveLocator(step);
          lines.push(`  await expect(${L}).toBeVisible();`);
        } else {
          lines.push(`  await expect(page.getByText(${q(step.value ?? '')})).toBeVisible();`);
        }
        break;
      }
      case 'assert_hidden': {
        if (step.target || step.elementId) {
          const L = resolveLocator(step);
          lines.push(`  await expect(${L}).toBeHidden();`);
        } else {
          lines.push(`  await expect(page.getByText(${q(step.value ?? '')})).toHaveCount(0);`);
        }
        break;
      }
      case 'assert_text': {
        const L = resolveLocator(step);
        lines.push(`  await expect(${L}).toContainText(${q(step.value ?? '')});`);
        break;
      }
      case 'assert_value': {
        const L = resolveLocator(step);
        lines.push(`  await expect(${L}).toHaveValue(${q(step.value ?? '')});`);
        break;
      }
      case 'assert_checked': {
        const L = resolveLocator(step);
        lines.push(`  await expect(${L}).toBeChecked();`);
        break;
      }
      case 'assert_unchecked': {
        const L = resolveLocator(step);
        lines.push(`  await expect(${L}).not.toBeChecked();`);
        break;
      }
      case 'assert_enabled': {
        const L = resolveLocator(step);
        lines.push(`  await expect(${L}).toBeEnabled();`);
        break;
      }
      case 'assert_disabled': {
        const L = resolveLocator(step);
        lines.push(`  await expect(${L}).toBeDisabled();`);
        break;
      }
      case 'assert_url': {
        lines.push(`  await expect(page).toHaveURL(url => url.href.includes(${q(step.value ?? '')}));`);
        break;
      }
      case 'assert_title': {
        lines.push(`  await expect(page).toHaveTitle(new RegExp(${q(escapeRegex(step.value ?? ''))}));`);
        break;
      }
      case 'assert_count': {
        const L = resolveLocator(step);
        const count = parseInt(step.value ?? '0', 10);
        lines.push(`  await expect(${L}).toHaveCount(${count});`);
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
// Module component implementation.
