import type { AppMap, InteractiveElement } from '../crawler/types.ts';
import type { ElementRef, TestDataEntry } from '../api/schemas.ts';

export function resolveElementRef(
  appMap: AppMap,
  ref: ElementRef,
): InteractiveElement | undefined {
  // 1. Same id AND same selectors.css
  const exact = appMap.elements.find(
    (e) => e.id === ref.elementId && e.selectors.css === ref.css,
  );
  if (exact) return exact;

  // 2. Unique element with that css on page 1
  const page1Matches = appMap.elements.filter(
    (e) => (e.page === undefined || e.page === 1) && e.selectors.css === ref.css,
  );
  if (page1Matches.length === 1) {
    return page1Matches[0];
  }

  // 3. Else undefined
  console.log(`[TestData] dropped ${ref.elementId}`);
  return undefined;
}

export interface ResolvedTestData {
  fills: Map<string, string>; // elementId -> value or secret token
  secrets: Map<string, string>; // token -> real secret value
  promptBlock: string;
}

export function resolveTestData(
  appMap: AppMap,
  entries: TestDataEntry[],
): ResolvedTestData {
  const fills = new Map<string, string>();
  const secrets = new Map<string, string>();
  const promptLines: string[] = [];
  let secretCounter = 0;

  for (const entry of entries) {
    if (!entry.value || entry.value.trim().length === 0) continue;

    const el = resolveElementRef(appMap, entry);
    if (!el) continue;

    let displayValue: string;

    if (entry.sensitive) {
      secretCounter += 1;
      const token = `__AGT_SECRET_${secretCounter}__`;
      fills.set(el.id, token);
      secrets.set(token, entry.value);
      displayValue = token;
    } else {
      fills.set(el.id, entry.value);
      displayValue = JSON.stringify(entry.value);
    }

    // Determine field label and form purpose
    const label = el.ariaLabel ?? el.placeholder ?? el.name ?? el.text ?? el.id;
    const form = appMap.forms?.find((f) => f.fieldIds.includes(el.id));
    let formPurposeStr = '';
    if (form) {
      formPurposeStr =
        form.purpose === 'login'
          ? ', login form'
          : form.purpose === 'signup'
            ? ', signup form'
            : form.purpose === 'search'
              ? ', search form'
              : ', form';
    }

    promptLines.push(`- ${el.id} (${label}${formPurposeStr}): ${displayValue}`);
  }

  let promptBlock = '';
  if (fills.size > 0) {
    promptBlock = [
      'TEST DATA TO FILL:',
      ...promptLines,
      '',
      'Use these exact values for fill/select steps on these elements. Values like __AGT_SECRET_1__ are secret placeholders: copy verbatim, never alter them, never use them in assert steps. Include at least one test case that completes each form containing these fields and verifies the outcome.',
    ].join('\n');
  }

  return { fills, secrets, promptBlock };
}
