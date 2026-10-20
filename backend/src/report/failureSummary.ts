import { sanitizeError } from '../runner/sanitizeError.ts';

export type FailureKind =
  | 'assertion'
  | 'element_missing'
  | 'ambiguous'
  | 'action_timeout'
  | 'test_timeout'
  | 'navigation'
  | 'other';

export interface FailureSummary {
  kind: FailureKind;
  headline: string;
  expected?: string;
  received?: string;
  target?: string;
  line?: number;
  codeFrame?: string;
}

const ROLE_MAP: Record<string, string> = {
  textbox: 'text box',
  combobox: 'dropdown',
  button: 'button',
  link: 'link',
  checkbox: 'checkbox',
  radio: 'radio button',
  'radio button': 'radio button',
  heading: 'heading',
  listitem: 'list item',
  'list item': 'list item',
  tab: 'tab',
  img: 'image',
  image: 'image',
};

export function humanizeLocator(loc: string): string {
  const clean = loc.trim().replace(/^page\./, '');

  // getByRole('role', { name: 'Name' })
  const roleWithName = clean.match(/getByRole\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*name:\s*['"]([^'"]+)['"]/);
  if (roleWithName) {
    const rawRole = roleWithName[1].toLowerCase();
    const role = ROLE_MAP[rawRole] ?? rawRole;
    return `the "${roleWithName[2]}" ${role}`;
  }

  // getByRole('role') without name
  const roleOnly = clean.match(/getByRole\(\s*['"]([^'"]+)['"]/);
  if (roleOnly) {
    const rawRole = roleOnly[1].toLowerCase();
    const role = ROLE_MAP[rawRole] ?? rawRole;
    return `the ${role}`;
  }

  // getByText('X')
  const byText = clean.match(/getByText\(\s*['"]([^'"]+)['"]/);
  if (byText) {
    return `the text "${byText[1]}"`;
  }

  // getByLabel('X')
  const byLabel = clean.match(/getByLabel\(\s*['"]([^'"]+)['"]/);
  if (byLabel) {
    return `the field labelled "${byLabel[1]}"`;
  }

  // getByPlaceholder('X')
  const byPlaceholder = clean.match(/getByPlaceholder\(\s*['"]([^'"]+)['"]/);
  if (byPlaceholder) {
    return `the field with placeholder "${byPlaceholder[1]}"`;
  }

  // getByTestId('X')
  const byTestId = clean.match(/getByTestId\(\s*['"]([^'"]+)['"]/);
  if (byTestId) {
    return `the element with test id "${byTestId[1]}"`;
  }

  // locator('css')
  const byLocator = clean.match(/locator\(\s*['"]([^'"]+)['"]\s*\)/);
  if (byLocator) {
    return `the element matching \`${byLocator[1]}\``;
  }

  // Fallback: if it's already a clean selector like #id or .class
  if (clean.startsWith('#') || clean.startsWith('.') || clean.startsWith('[')) {
    return `the element matching \`${clean}\``;
  }

  return clean;
}

function formatTimeout(msStr: string | number): string {
  const ms = typeof msStr === 'number' ? msStr : parseInt(String(msStr), 10);
  if (isNaN(ms)) return `${msStr}s`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`;
}

function extractTargetFromError(sanitized: string): string | undefined {
  const locatorLine = sanitized.match(/Locator:\s+(.*?)(\r?\n|$)/i);
  if (locatorLine) {
    return humanizeLocator(locatorLine[1]);
  }
  const waitingFor = sanitized.match(/waiting for (locator\([^)]+\)|getBy[^)]+\))/i);
  if (waitingFor) {
    return humanizeLocator(waitingFor[1]);
  }
  const strictTarget = sanitized.match(/strict mode violation:\s*(.*?)\s+resolved to/i);
  if (strictTarget) {
    return humanizeLocator(strictTarget[1]);
  }
  return undefined;
}

function getErrorHeader(sanitized: string): string {
  const codeFrameIndex = sanitized.search(/^\s*>?\s*\d+\s*\|/m);
  const callLogIndex = sanitized.indexOf('Call log:');

  let cutIndex = sanitized.length;
  if (codeFrameIndex !== -1) cutIndex = Math.min(cutIndex, codeFrameIndex);
  if (callLogIndex !== -1) cutIndex = Math.min(cutIndex, callLogIndex);

  return sanitized.slice(0, cutIndex);
}

export function summarizeFailure(rawError: string | null | undefined, _code?: string): FailureSummary {
  const sanitized = sanitizeError(rawError);
  if (!sanitized) {
    return { kind: 'other', headline: 'Unknown error occurred during test execution.' };
  }

  // Header is text before first code-frame line or before "Call log:", whichever comes first
  const header = getErrorHeader(sanitized);

  // Extract line and codeFrame (BUG B fix)
  let line: number | undefined;
  const lineMatch = sanitized.match(/^\s*>\s*(\d+)\s*\|/m);
  if (lineMatch) {
    line = parseInt(lineMatch[1], 10);
  }

  const lines = sanitized.split(/\r?\n/);
  const frameLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>?\s*\d+\s*\|/.test(l)) {
      frameLines.push(l);
      if (/^\s*>\s*\d+\s*\|/.test(l)) {
        if (i + 1 < lines.length && /^\s*\|\s*\^/.test(lines[i + 1])) {
          frameLines.push(lines[i + 1]);
          i++;
        }
      }
    }
  }
  const codeFrame = frameLines.length > 0 ? frameLines.join('\n') : undefined;

  // Extract target: look in header first
  let target: string | undefined;
  const headerLocatorMatch = header.match(/^\s*Locator:\s+(.*)$/m);
  if (headerLocatorMatch) {
    target = humanizeLocator(headerLocatorMatch[1]);
  } else {
    target = extractTargetFromError(sanitized);
  }

  // Expected & Received parsing accepting Playwright 1.63 labels
  let expected: string | undefined;
  let received: string | undefined;
  const expMatch = sanitized.match(/^\s*Expected(?: string| pattern| substring| value)?:\s*(.*)$/m);
  if (expMatch) expected = expMatch[1].trim();
  const recMatch = sanitized.match(/^\s*Received(?: string| value)?:\s*(.*)$/m);
  if (recMatch) received = recMatch[1].trim();

  // 1. Strict mode violation (kept first)
  const strictMatch = sanitized.match(/strict mode violation:\s*(.*?)\s+resolved to (\d+) elements/i);
  if (strictMatch) {
    const loc = humanizeLocator(strictMatch[1]);
    const count = strictMatch[2];
    const capitalLoc = loc.charAt(0).toUpperCase() + loc.slice(1);
    return {
      kind: 'ambiguous',
      headline: `${capitalLoc} matched ${count} elements, so the test couldn't tell which one to use.`,
      target: loc,
      line,
      codeFrame,
    };
  }

  // Compute failedMatcher and isNot from the error header only
  const matcherMatch = header.match(/expect\((?:locator|page|received)\)\.(not\.)?(\w+)\(/);
  let failedMatcher: string | undefined;
  let isNot = false;
  if (matcherMatch) {
    isNot = Boolean(matcherMatch[1]);
    failedMatcher = matcherMatch[2];
  }

  // 2. Matcher-specific branches routed by failedMatcher
  if (failedMatcher === 'toBeVisible') {
    const t = target ?? 'the element';
    if (isNot) {
      return {
        kind: 'assertion',
        headline: `Expected ${t} to be hidden; it was visible.`,
        expected,
        received,
        target: t,
        line,
        codeFrame,
      };
    }
    if (
      sanitized.includes('not found') ||
      sanitized.includes('element(s) not found') ||
      received?.includes('not found')
    ) {
      return {
        kind: 'element_missing',
        headline: `Expected ${t} to be visible; it was not found on the page.`,
        expected,
        received,
        target: t,
        line,
        codeFrame,
      };
    }
    return {
      kind: 'assertion',
      headline: `Expected ${t} to be visible; it exists but is hidden.`,
      expected,
      received,
      target: t,
      line,
      codeFrame,
    };
  }

  if (failedMatcher === 'toBeHidden') {
    const t = target ?? 'the element';
    if (isNot) {
      return {
        kind: 'assertion',
        headline: `Expected ${t} to be visible; it was hidden.`,
        expected,
        received,
        target: t,
        line,
        codeFrame,
      };
    }
    return {
      kind: 'assertion',
      headline: `Expected ${t} to be hidden; it was visible.`,
      expected,
      received,
      target: t,
      line,
      codeFrame,
    };
  }

  if (
    failedMatcher === 'toHaveText' ||
    failedMatcher === 'toContainText' ||
    failedMatcher === 'toHaveValue'
  ) {
    const t = target ?? 'the element';
    const matcher = failedMatcher;
    const verb = matcher === 'toHaveValue' ? 'to have value' : 'to contain';
    if (isNot) {
      return {
        kind: 'assertion',
        headline: `Expected ${t} not ${verb} ${expected ?? 'the expected text'}; it did.`,
        expected,
        received,
        target: t,
        line,
        codeFrame,
      };
    }
    let recDesc = 'it was empty';
    if (received && received !== '""' && received !== "''") {
      recDesc = `it ${matcher === 'toHaveValue' ? 'had value' : 'contained'} ${received}`;
    }
    return {
      kind: 'assertion',
      headline: `Expected ${t} ${verb} ${expected ?? 'the expected text'}; ${recDesc}.`,
      expected,
      received,
      target: t,
      line,
      codeFrame,
    };
  }

  if (failedMatcher === 'toHaveURL') {
    if (isNot) {
      return {
        kind: 'assertion',
        headline: `Expected the page address not to be ${expected ?? 'the address'}; it was.`,
        expected,
        received,
        line,
        codeFrame,
      };
    }
    let recDesc = received ? `; it was ${received}` : '';
    let expDesc = expected ?? 'the expected address';
    if (expDesc.includes('[Function') || expDesc.includes('predicate')) {
      expDesc = 'the expected address';
    }
    return {
      kind: 'assertion',
      headline: `Expected the page address to include ${expDesc}${recDesc}.`,
      expected,
      received,
      line,
      codeFrame,
    };
  }

  if (failedMatcher === 'toHaveCount') {
    const t = target ?? 'the element';
    let pluralT = `${t}s`;
    if (t.startsWith('the element matching')) {
      pluralT = t.replace('the element matching', 'elements matching');
    }
    if (isNot) {
      return {
        kind: 'assertion',
        headline: `Expected not to find ${expected ?? 'N'} ${pluralT}; found ${received ?? '0'}.`,
        expected,
        received,
        target: t,
        line,
        codeFrame,
      };
    }
    return {
      kind: 'assertion',
      headline: `Expected ${expected ?? 'N'} ${pluralT}; found ${received ?? '0'}.`,
      expected,
      received,
      target: t,
      line,
      codeFrame,
    };
  }

  if (failedMatcher === 'toHaveTitle') {
    if (isNot) {
      return {
        kind: 'assertion',
        headline: `Expected the page title not to be ${expected ?? ''}; it was.`,
        expected,
        received,
        line,
        codeFrame,
      };
    }
    return {
      kind: 'assertion',
      headline: `Expected the page title to be ${expected ?? ''}; it was ${received ?? ''}.`,
      expected,
      received,
      line,
      codeFrame,
    };
  }

  if (failedMatcher === 'toBeChecked') {
    const t = target ?? 'the element';
    return {
      kind: 'assertion',
      headline: isNot
        ? `Expected ${t} to be unchecked; it was checked.`
        : `Expected ${t} to be checked; it was unchecked.`,
      target: t,
      line,
      codeFrame,
    };
  }

  if (failedMatcher === 'toBeEnabled') {
    const t = target ?? 'the element';
    return {
      kind: 'assertion',
      headline: isNot
        ? `Expected ${t} to be disabled; it was enabled.`
        : `Expected ${t} to be enabled; it was disabled.`,
      target: t,
      line,
      codeFrame,
    };
  }

  if (failedMatcher === 'toBeDisabled') {
    const t = target ?? 'the element';
    return {
      kind: 'assertion',
      headline: isNot
        ? `Expected ${t} to be enabled; it was disabled.`
        : `Expected ${t} to be disabled; it was enabled.`,
      target: t,
      line,
      codeFrame,
    };
  }

  if (
    failedMatcher === 'toHaveAttribute' ||
    failedMatcher === 'toHaveClass' ||
    failedMatcher === 'toHaveId'
  ) {
    const t = target ?? 'the element';
    return {
      kind: 'assertion',
      headline: `Expected ${t} to have ${failedMatcher.replace(/^toHave/, '').toLowerCase()} ${expected ?? ''}; received ${received ?? ''}.`,
      expected,
      received,
      target: t,
      line,
      codeFrame,
    };
  }

  if (failedMatcher === 'toBe' || failedMatcher === 'toEqual') {
    return {
      kind: 'assertion',
      headline: `Expected ${expected ?? 'the expected value'}; received ${received ?? 'different value'}.`,
      expected,
      received,
      target,
      line,
      codeFrame,
    };
  }

  // 3. Action timeout (click / fill / press / etc.) when no expect header is present
  const actionTimeoutMatch = sanitized.match(
    /(?:TimeoutError:\s*)?(?:locator|page)\.([a-zA-Z]+):\s*Timeout\s*(\d+)ms\s*exceeded/i,
  );
  if (actionTimeoutMatch && !sanitized.includes('Test timeout')) {
    const action = actionTimeoutMatch[1].toLowerCase();
    const duration = formatTimeout(actionTimeoutMatch[2]);
    const t = target ?? 'the element';
    return {
      kind: 'action_timeout',
      headline: `Could not ${action} ${t} within ${duration}; it never became available.`,
      target: t,
      line,
      codeFrame,
    };
  }

  // 4. Test timeout
  const testTimeoutMatch = sanitized.match(/Test timeout of (\d+)ms exceeded/i);
  if (testTimeoutMatch) {
    const duration = formatTimeout(testTimeoutMatch[1]);
    return {
      kind: 'test_timeout',
      headline: `The test took longer than ${duration}.`,
      line,
      codeFrame,
    };
  }

  // 5. Navigation errors (net::ERR_*)
  if (sanitized.includes('net::ERR_')) {
    const errCode = sanitized.match(/net::(ERR_[A-Z0-9_]+)/)?.[1];
    return {
      kind: 'navigation',
      headline: errCode ? `Navigation failed with ${errCode}.` : 'Failed to navigate to the target address.',
      line,
      codeFrame,
    };
  }

  // Fallback: first meaningful sanitized line
  const firstLine =
    sanitized
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('at ') && !l.startsWith('>')) || 'Test failed.';
  const cleanHeadline = firstLine.replace(/^(Error:\s*)+/, '').trim();

  return {
    kind: 'other',
    headline: cleanHeadline,
    expected,
    received,
    target,
    line,
    codeFrame,
  };
}
