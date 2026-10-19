// Heuristic confidence in a generated test's quality (0-100), computed
// from persisted facts only: the final code and its attempt history.
// Deliberately compute-on-read — no schema column — so the heuristic can
// evolve without a migration or stale stored scores.

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface ConfidenceFactor {
  label: string;
  points: number;
}

export interface ConfidenceScore {
  score: number;
  band: ConfidenceBand;
  factors: ConfidenceFactor[];
}

export interface ConfidenceAttemptInput {
  corrected: boolean;
  validationPassed: boolean;
  executionPassed?: boolean | null;
  failureClass?: string | null;
}

export interface ConfidenceInput {
  code: string;
  finalStatus: 'passed' | 'failed' | 'gave_up' | 'needs_review';
  attempts: readonly ConfidenceAttemptInput[];
}

function countMatches(code: string, pattern: RegExp): number {
  return code.match(pattern)?.length ?? 0;
}

// Points budget sums to exactly 100 at the ceiling:
// base 40 + selectors 25 + assertions 12 + coverage 8 + no-correction 5 + passed 10.
export function scoreTestConfidence(input: ConfidenceInput): ConfidenceScore {
  const factors: ConfidenceFactor[] = [{ label: 'base', points: 40 }];
  const { code } = input;

  // Selector specificity: weighted mean over locator calls in the final code.
  const testId = countMatches(code, /\bgetByTestId\s*\(/g);
  const role = countMatches(code, /\bgetByRole\s*\(/g);
  const placeholderOrLabel = countMatches(code, /\bgetByPlaceholder\s*\(/g)
    + countMatches(code, /\bgetByLabel\s*\(/g);
  const text = countMatches(code, /\bgetByText\s*\(/g);
  const css = countMatches(code, /\.locator\s*\(/g);
  const locatorCalls = testId + role + placeholderOrLabel + text + css;
  if (locatorCalls === 0) {
    factors.push({ label: 'no element locators (page-level assertions only)', points: 8 });
  } else {
    const weighted = (testId * 1 + role * 0.8 + placeholderOrLabel * 0.65
      + text * 0.45 + css * 0.2) / locatorCalls;
    factors.push({
      label: `selector specificity (${testId} testId, ${role} role, ${placeholderOrLabel} placeholder/label, ${text} text, ${css} css)`,
      points: Math.round(weighted * 25),
    });
  }

  const assertions = countMatches(code, /\bexpect\s*\(/g);
  const assertionPoints = assertions === 0 ? -15 : assertions === 1 ? 4 : assertions === 2 ? 8 : 12;
  factors.push({ label: `assertions (${assertions})`, points: assertionPoints });

  // Code-level proxy for planned step count: interactions actually emitted.
  const actions = countMatches(code, /\.(?:click|fill|press|hover|selectOption|check|uncheck|goto)\s*\(/g);
  const interactions = actions + assertions;
  const coveragePoints = interactions <= 2 ? -6 : interactions <= 6 ? 8 : interactions <= 10 ? 5 : 0;
  factors.push({ label: `coverage (${interactions} interactions)`, points: coveragePoints });

  const corrections = input.attempts.filter((attempt) => attempt.corrected).length;
  factors.push({
    label: corrections === 0 ? 'no correction needed' : `corrections applied (${corrections})`,
    points: corrections === 0 ? 5 : -7 * corrections,
  });

  // 'failed' means the test executed and caught real app behaviour (a
  // finding) — the test itself is credible, so it is not scored like gave_up.
  const outcomePoints = input.finalStatus === 'passed' ? 10 : input.finalStatus === 'failed' ? 4 : -15;
  factors.push({ label: `final status (${input.finalStatus})`, points: outcomePoints });

  const lastAttempt = input.attempts[input.attempts.length - 1];
  if (lastAttempt !== undefined) {
    if (!lastAttempt.validationPassed) {
      factors.push({ label: 'final attempt failed static validation', points: -12 });
    } else if (lastAttempt.failureClass === 'timeout' || lastAttempt.failureClass === 'locator') {
      factors.push({ label: `final failure class (${lastAttempt.failureClass})`, points: -8 });
    } else if (lastAttempt.failureClass === 'other') {
      factors.push({ label: 'final failure class (other)', points: -4 });
    }
  }

  const raw = factors.reduce((sum, factor) => sum + factor.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { score, band: score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low', factors };
}
// Module component implementation.
