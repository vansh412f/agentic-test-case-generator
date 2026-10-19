import type { AppMap } from '../crawler/types.ts';

export interface StaleExpectationCheckParams {
  failureClass?: string | null;
  failureContext?: { finalUrl?: string; navigations?: string[] } | null;
  error?: string | null;
  appMap?: AppMap | null;
  startUrl?: string;
  isBaseline?: boolean;
}

export function getCanonicalPageUrl(raw: string): string {
  try {
    const u = new URL(raw);
    let p = u.origin + u.pathname;
    if (u.hash && u.hash.startsWith('#/')) {
      p += u.hash;
    }
    return p;
  } catch {
    return raw;
  }
}

export function normalizeSelectorString(s: string): string {
  return s
    .replace(/['"`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Evaluates whether a test failure is caused by a stale expectation
 * (the page navigated away, and the test was looking for an element from the start page).
 */
export function isStaleExpectation(params: StaleExpectationCheckParams): boolean {
  // Never applies to baselines
  if (params.isBaseline) return false;

  // (a) failureClass in {locator, timeout}
  const fc = params.failureClass;
  if (fc !== 'locator' && fc !== 'timeout') {
    return false;
  }

  // (b) failureContext exists and canonical finalUrl differs from start URL
  const fcCtx = params.failureContext;
  if (!fcCtx || !fcCtx.finalUrl) {
    return false;
  }

  const initialUrl = fcCtx.navigations?.[0] || params.startUrl || params.appMap?.url;
  if (!initialUrl) {
    return false;
  }

  const finalCanon = getCanonicalPageUrl(fcCtx.finalUrl);
  const initialCanon = getCanonicalPageUrl(initialUrl);
  if (finalCanon === initialCanon) {
    return false;
  }

  // (c) the failing locator equals one of the selector expressions of an element on the START page in the appMap
  if (!params.error || !params.appMap) {
    return false;
  }

  // Extract failing locator from error: "Locator: …" or "waiting for getBy…/locator(…)"
  let rawLocator: string | null = null;
  const locMatch = params.error.match(/Locator:\s*(.*?)(\r?\n|$)/i);
  if (locMatch) {
    rawLocator = locMatch[1].trim();
  } else {
    const waitMatch = params.error.match(/waiting for\s+((?:getBy[a-zA-Z]*|locator)\(.*?\)|#[\w-]+|\.[\w-]+)/i);
    if (waitMatch) {
      rawLocator = waitMatch[1].trim();
    }
  }

  if (!rawLocator) {
    return false;
  }

  const normLocator = normalizeSelectorString(rawLocator);

  // Check against all elements on the start page (page undefined or 1)
  const startElements = params.appMap.elements.filter((el) => !el.page || el.page === 1);
  for (const el of startElements) {
    const selectors = el.selectors;
    const candidates = [
      selectors.css,
      `locator('${selectors.css}')`,
      selectors.getByRole,
      selectors.getByText,
      selectors.getByTestId,
      selectors.getByPlaceholder,
      selectors.getByLabel,
    ].filter(Boolean) as string[];

    for (const cand of candidates) {
      const normCand = normalizeSelectorString(cand);
      if (normCand === normLocator) {
        return true;
      }
      // Check unwrapped locator css matches cand
      const innerMatch = normLocator.match(/^locator\('(.*)'\)$/);
      if (innerMatch && normalizeSelectorString(innerMatch[1]) === normCand) {
        return true;
      }
      const candInnerMatch = normCand.match(/^locator\('(.*)'\)$/);
      if (candInnerMatch && normalizeSelectorString(candInnerMatch[1]) === normLocator) {
        return true;
      }
    }
  }

  return false;
}
