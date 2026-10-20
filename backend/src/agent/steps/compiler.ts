import type { TestCase, PlanStep, PlanStepTarget } from '../prompts/plannerPrompt.ts';
import type { ScopedElement } from '../types.ts';
import type { GeneratedTest } from './generator.ts';
import type { Observation } from '../../crawler/types.ts';

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompileError';
  }
}

const PRIORITY = ['getByTestId', 'getByRole', 'getByPlaceholder', 'getByLabel', 'getByText'] as const;
const SAFE = /^getBy(TestId|Role|Placeholder|Label|Text)\(/;

export function locatorFor(el: ScopedElement, pageVar = 'page'): string {
  for (const key of PRIORITY) {
    const expr = el.selectors[key];
    if (expr && SAFE.test(expr)) {
      return `${pageVar}.${expr}`;
    }
  }
  return `${pageVar}.locator(${JSON.stringify(el.selectors.css)})`;
}

const q = (v: string): string => JSON.stringify(v);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function urlAssertPattern(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const hashPart = parsed.hash && parsed.hash.startsWith('#/') ? parsed.hash : '';
      let pathPart = parsed.pathname;
      if (pathPart === '/' && !hashPart) {
        pathPart = '';
      }
      let base = `${parsed.origin}${pathPart}${hashPart}`;
      if (base.endsWith('/')) {
        base = base.slice(0, -1);
      }
      return '^' + escapeRegex(base) + '/?(?:[?#].*)?$';
    }
  } catch {
    // not an absolute URL
  }
  return escapeRegex(value);
}

function locatorForTarget(target: PlanStepTarget, pageVar = 'page'): string {
  const roleArg = q(target.role);
  const nameArg = target.name !== undefined ? `, { name: ${q(target.name)} }` : '';
  const roleCall = `getByRole(${roleArg}${nameArg})`;

  if (target.container && target.withinText) {
    return `${pageVar}.getByRole(${q(target.container)}).filter({ hasText: ${q(target.withinText)} }).${roleCall}`;
  }
  if (target.withinText) {
    return `${pageVar}.${roleCall}.filter({ hasText: ${q(target.withinText)} })`;
  }
  return `${pageVar}.${roleCall}`;
}

export function compileTest(
  testCase: TestCase,
  elementsInScope: ScopedElement[],
  targetUrl: string,
  observations?: Observation[],
): GeneratedTest {
  const elementsMap = new Map<string, ScopedElement>(
    elementsInScope.map((e) => [e.id, e]),
  );

  let pageVar = 'page';
  let popupHandled = false;

  const getLocator = (elementId: string | null): string => {
    if (!elementId) {
      throw new CompileError(`Step requires elementId, but received null/undefined`);
    }
    const el = elementsMap.get(elementId);
    if (!el) {
      throw new CompileError(`Unknown elementId "${elementId}" in test case "${testCase.id}"`);
    }
    return locatorFor(el, pageVar);
  };

  const resolveLocator = (step: PlanStep): string => {
    if (step.target) {
      return locatorForTarget(step.target, pageVar);
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
        const isPopupTrigger =
          !popupHandled &&
          Boolean(step.elementId) &&
          Boolean(observations?.some((o) => o.kind === 'popup' && o.elementId === step.elementId));

        const L = (!step.elementId && !step.target && step.value)
          ? `${pageVar}.getByText(${q(step.value)}, { exact: true })`
          : resolveLocator(step);

        if (isPopupTrigger) {
          lines.push(`  const popupPromise = page.context().waitForEvent('page');`);
          lines.push(`  await ${L}.click();`);
          lines.push(`  const popup = await popupPromise;`);
          lines.push(`  await popup.waitForLoadState('domcontentloaded');`);
          pageVar = 'popup';
          popupHandled = true;
        } else {
          lines.push(`  await ${L}.click();`);
        }
        break;
      }
      case 'dblclick': {
        const L = (!step.elementId && !step.target && step.value)
          ? `${pageVar}.getByText(${q(step.value)}, { exact: true })`
          : resolveLocator(step);
        lines.push(`  await ${L}.dblclick();`);
        break;
      }
      case 'hover': {
        const L = (!step.elementId && !step.target && step.value)
          ? `${pageVar}.getByText(${q(step.value)}, { exact: true })`
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
        lines.push(`  await ${pageVar}.reload();`);
        break;
      }
      case 'go_back': {
        lines.push(`  await ${pageVar}.goBack();`);
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
        lines.push(`  await ${pageVar}.goto(${q(step.value ?? '')});`);
        break;
      }
      case 'assert_visible': {
        if (step.target || step.elementId) {
          const L = resolveLocator(step);
          lines.push(`  await expect(${L}).toBeVisible();`);
        } else {
          lines.push(`  await expect(${pageVar}.getByText(${q(step.value ?? '')})).toBeVisible();`);
        }
        break;
      }
      case 'assert_hidden': {
        if (step.target || step.elementId) {
          const L = resolveLocator(step);
          lines.push(`  await expect(${L}).toBeHidden();`);
        } else {
          lines.push(`  await expect(${pageVar}.getByText(${q(step.value ?? '')})).toHaveCount(0);`);
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
        const pattern = urlAssertPattern(step.value ?? '');
        const escapedForLiteral = pattern.replace(/\//g, '\\/');
        lines.push(`  await expect(${pageVar}).toHaveURL(/${escapedForLiteral}/);`);
        break;
      }
      case 'assert_title': {
        lines.push(`  await expect(${pageVar}).toHaveTitle(new RegExp(${q(escapeRegex(step.value ?? ''))}));`);
        break;
      }
      case 'assert_count': {
        const count = parseInt(step.value ?? '0', 10);
        let countObs: Observation | undefined;
        if (observations && observations.length > 0 && step.elementId) {
          countObs = observations.find(
            (o) => o.kind === 'count' && o.elementId === step.elementId && o.containerCss && o.role,
          );
          if (!countObs) {
            const stepEl = elementsMap.get(step.elementId) as { ariaRole?: string | null } | undefined;
            if (stepEl?.ariaRole) {
              countObs = observations.find(
                (o) => o.kind === 'count' && o.role === stepEl.ariaRole && o.containerCss && o.role,
              );
            }
          }
        }

        if (countObs && countObs.containerCss && countObs.role) {
          lines.push(
            `  await expect(${pageVar}.locator(${q(countObs.containerCss)}).getByRole(${q(countObs.role)})).toHaveCount(${count});`,
          );
        } else {
          const L = resolveLocator(step);
          lines.push(`  await expect(${L}).toHaveCount(${count});`);
        }
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
