import type { RawElement, RawForm, RawLink, RawPageExtraction } from './rawTypes.ts';
import { AppMapSchema, type AppMap, type ElementType, type Form, type FormPurpose, type InteractiveElement } from './types.ts';
import { MAX_DISCOVERED_LINKS } from '../agent/run.config.ts';

export function isSkipLink(el: InteractiveElement): boolean {
  const isLink = el.type === 'link' || (typeof el.tagName === 'string' && el.tagName.toUpperCase() === 'A');
  if (!isLink) return false;
  const text = (el.text ?? '').trim();
  const ariaLabel = (el.ariaLabel ?? '').trim();
  const href = (el.href ?? '').trim();

  const textOrAriaMatchesContent =
    /^skip to (main )?content$/i.test(text) || /^skip to (main )?content$/i.test(ariaLabel);
  if (textOrAriaMatchesContent) return true;

  const hrefMatchesAnchor = /^#(main|content|skip)/i.test(href);
  const textOrAriaMatchesSkip = /skip/i.test(text) || /skip/i.test(ariaLabel);
  if (hrefMatchesAnchor && textOrAriaMatchesSkip) return true;

  return false;
}

export interface BuildAppMapInput {
  // The final URL after redirects (page.url()), not the URL the user typed
  url: string;
  viewport: { width: number; height: number };
  extraction: RawPageExtraction;
}

interface IdentifiedElement {
  id: string;
  raw: RawElement;
}

// Element types that count as user-fillable fields of a form
const FORM_FIELD_TYPES = new Set<ElementType>(['input', 'textarea', 'select', 'checkbox', 'radio']);

const SIGNUP_SUBMIT_TEXT = /sign\s?up|register|create (an )?account|join/i;
const AUTH_SUBMIT_BUTTON_TEXT = /\b(log\s*in|sign\s*in|submit|continue|enter|next|verify|sign\s*up|register|create\s*(an\s*)?account)\b/i;
const NON_SUBMIT_BUTTON_TEXT = /\b(google|github|apple|facebook|microsoft|gitlab|sso|oauth|passkey|forgot|reset|cancel|clear|close|back|show|hide|toggle|visibility|eye)\b/i;

const ASSET_PATH_REGEX = /\.(pdf|jpe?g|png|gif|svg|webp|ico|zip|mp4|mp3|css|js|xml|json|txt)$/i;

const TRACKING_PARAM_REGEXES = [
  /^utm_/i,
  /^ref$/i,
  /^ref_$/i,
  /^tag$/i,
  /^gclid$/i,
  /^fbclid$/i,
  /^pd_rd_/i,
  /^pf_rd_/i,
  /^qid$/i,
  /^sr$/i,
  /^crid$/i,
  /^sprefix$/i,
  /^_encoding$/i,
];

export function isIdLikeSegment(seg: string): boolean {
  if (/^\d{4,}$/.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^[a-z0-9]{8,}$/i.test(seg) && /\d/.test(seg) && /[a-z]/i.test(seg)) return true;
  return false;
}

export function normalizePathTemplate(pathname: string): string {
  const withoutRef = pathname.replace(/\/ref=[^/]*/g, '');
  const rawSegments = withoutRef.split('/').filter(Boolean);
  const segments = rawSegments.map((seg) => (isIdLikeSegment(seg) ? ':id' : seg));
  if (segments.length === 0) return '/';
  return '/' + segments.join('/');
}

function cleanStoredHref(url: URL): string {
  const clone = new URL(url.href);
  clone.hash = '';
  clone.pathname = clone.pathname.replace(/\/ref=[^/]*/g, '') || '/';
  const toDelete: string[] = [];
  for (const [key] of clone.searchParams.entries()) {
    if (TRACKING_PARAM_REGEXES.some((r) => r.test(key))) {
      toDelete.push(key);
    }
  }
  for (const key of toDelete) {
    clone.searchParams.delete(key);
  }
  return clone.href;
}

function titleCaseWord(w: string): string {
  if (!w) return '';
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function titleCase(text: string): string {
  return text
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(titleCaseWord)
    .join(' ');
}

export function deriveFallbackLabel(pathname: string): string {
  const rawSegments = pathname.split('/').filter(Boolean);
  const eligible = rawSegments.filter((seg) => {
    if (seg === ':id' || isIdLikeSegment(seg)) return false;
    if (seg.startsWith('ref=')) return false;
    if (seg.length <= 2) return false;
    return true;
  });

  if (eligible.length > 0) {
    const lastSeg = eligible[eligible.length - 1];
    try {
      const decoded = decodeURIComponent(lastSeg);
      return titleCase(decoded);
    } catch {
      return titleCase(lastSeg);
    }
  }

  return pathname.replace(/\/$/, '') || '/';
}

export function classifyFormPurpose(
  rawForm: RawForm,
  fields: RawElement[],
  submitControl: RawElement | undefined,
): FormPurpose {
  if (rawForm.ariaRole === 'search' || fields.some((field) => field.inputType === 'search')) {
    return 'search';
  }

  const passwordFieldCount = fields.filter((field) => field.inputType === 'password').length;
  if (passwordFieldCount >= 2) return 'signup';
  if (passwordFieldCount === 1) {
    return SIGNUP_SUBMIT_TEXT.test(submitControl?.text ?? '') ? 'signup' : 'login';
  }
  return 'unknown';
}

function buildForms(rawForms: RawForm[], elements: IdentifiedElement[]): Form[] {
  const forms: Form[] = rawForms.map((rawForm, formIndex) => {
    const members = elements.filter(({ raw }) => raw.formIndex === formIndex);
    const fields = members.filter(({ raw }) => FORM_FIELD_TYPES.has(raw.type));
    let submitControl = members.find(({ raw }) => raw.isSubmitControl);

    // 1. Fallback submit button inside <form> when type="button" was used instead of type="submit"
    if (!submitControl) {
      const candidateButtons = members.filter(
        ({ raw }) =>
          raw.isVisible &&
          raw.type === 'button' &&
          !NON_SUBMIT_BUTTON_TEXT.test((raw.text ?? raw.ariaLabel ?? '').trim()),
      );
      const authMatch = candidateButtons.find(({ raw }) =>
        AUTH_SUBMIT_BUTTON_TEXT.test((raw.text ?? raw.ariaLabel ?? '').trim()),
      );
      if (authMatch) {
        submitControl = authMatch;
      } else if (fields.length > 0 && candidateButtons.length === 1) {
        submitControl = candidateButtons[0];
      }
    }

    return {
      id: rawForm.domId ?? `form-${formIndex + 1}`,
      name: rawForm.name,
      action: rawForm.action,
      method: rawForm.method,
      purpose: classifyFormPurpose(rawForm, fields.map(({ raw }) => raw), submitControl?.raw),
      fieldIds: fields.map(({ id }) => id),
      submitButtonId: submitControl?.id ?? null,
    };
  });

  // 2. Synthesize a virtual auth Form for formless React/SPA login cards (raw.formIndex === null)
  const existingFieldIds = new Set<string>();
  for (const f of forms) {
    for (const fid of f.fieldIds) {
      existingFieldIds.add(fid);
    }
  }

  const ungroupedPasswordEls = elements
    .map((el, index) => ({ el, index }))
    .filter(
      ({ el }) =>
        el.raw.formIndex === null &&
        el.raw.isVisible &&
        el.raw.type === 'input' &&
        (el.raw.inputType ?? '').toLowerCase() === 'password' &&
        !existingFieldIds.has(el.id),
    );

  if (ungroupedPasswordEls.length >= 1) {
    const firstPwIdx = ungroupedPasswordEls[0].index;
    const lastPwIdx = ungroupedPasswordEls[ungroupedPasswordEls.length - 1].index;

    // Nearby text-entry fields within [Math.max(0, firstPwIdx - 4), lastPwIdx]
    const minIdx = Math.max(0, firstPwIdx - 4);
    const textEntryTypes = ['text', 'email', 'tel', 'number', 'password'];
    const nearbyFields = elements
      .slice(minIdx, lastPwIdx + 1)
      .filter(
        (el) =>
          el.raw.formIndex === null &&
          el.raw.isVisible &&
          el.raw.type === 'input' &&
          textEntryTypes.includes((el.raw.inputType ?? 'text').toLowerCase()) &&
          (el.raw.inputType ?? 'text').toLowerCase() !== 'search' &&
          !existingFieldIds.has(el.id),
      );

    // Nearby submit button at index > lastPwIdx (within lastPwIdx + 6)
    const submitButton = elements.slice(lastPwIdx + 1, lastPwIdx + 7).find((el) => {
      if (el.raw.formIndex !== null || !el.raw.isVisible) return false;
      const isButton = el.raw.type === 'button' || el.raw.isSubmitControl;
      if (!isButton) return false;
      const label = (el.raw.text ?? el.raw.ariaLabel ?? '').trim();
      return AUTH_SUBMIT_BUTTON_TEXT.test(label) && !NON_SUBMIT_BUTTON_TEXT.test(label);
    });

    if (nearbyFields.length >= 1 && submitButton) {
      forms.push({
        id: `form-auth-${forms.length + 1}`,
        name: null,
        action: null,
        method: 'post',
        purpose:
          ungroupedPasswordEls.length >= 2 || SIGNUP_SUBMIT_TEXT.test(submitButton.raw.text ?? '')
            ? 'signup'
            : 'login',
        fieldIds: nearbyFields.map((f) => f.id),
        submitButtonId: submitButton.id,
      });
    }
  }

  return forms;
}

export function filterInternalLinks(
  links: Array<RawLink | { href: string; text?: string; inNav?: boolean } | string>,
  pageUrl: string,
): { links: string[]; labels: Record<string, string>; totalUnique: number } {
  const pageLocation = new URL(pageUrl);
  const currentPageKey = pageLocation.origin + normalizePathTemplate(pageLocation.pathname);

  interface Entry {
    key: string;
    href: string;
    inNav: boolean;
    domOrder: number;
    label: string;
    fallbackLabel: string;
  }

  const entriesByKey = new Map<string, Entry>();
  let domCounter = 0;

  for (const item of links) {
    domCounter++;
    const rawHref = typeof item === 'string' ? item : item.href;
    const rawText = (typeof item === 'string' ? '' : item.text ?? '').trim();
    const rawInNav = typeof item === 'string' ? false : Boolean(item.inNav);

    let parsed: URL;
    try {
      parsed = new URL(rawHref, pageLocation);
    } catch {
      continue;
    }

    // Same origin only (drops mailto, tel, javascript)
    if (parsed.origin !== pageLocation.origin) continue;

    // Skip asset URLs
    if (ASSET_PATH_REGEX.test(parsed.pathname)) continue;

    const template = normalizePathTemplate(parsed.pathname);
    const dedupeKey = parsed.origin + template;

    // Skip current page link
    if (dedupeKey === currentPageKey) continue;

    const existing = entriesByKey.get(dedupeKey);
    if (!existing) {
      const cleanedHref = cleanStoredHref(parsed);
      const fallbackLabel = deriveFallbackLabel(parsed.pathname);
      entriesByKey.set(dedupeKey, {
        key: dedupeKey,
        href: cleanedHref,
        inNav: rawInNav,
        domOrder: domCounter,
        label: rawText,
        fallbackLabel,
      });
    } else {
      if (rawInNav && !existing.inNav) {
        existing.inNav = true;
      }
      if (!existing.label && rawText) {
        existing.label = rawText;
      }
    }
  }

  const allEntries = Array.from(entriesByKey.values());
  const totalUnique = allEntries.length;

  allEntries.sort((a, b) => {
    if (a.inNav !== b.inNav) {
      return a.inNav ? -1 : 1;
    }
    return a.domOrder - b.domOrder;
  });

  const capped = allEntries.slice(0, MAX_DISCOVERED_LINKS);
  const resultLinks = capped.map((e) => e.href);
  const resultLabels: Record<string, string> = {};
  for (const e of capped) {
    resultLabels[e.href] = e.label || e.fallbackLabel;
  }

  return {
    links: resultLinks,
    labels: resultLabels,
    totalUnique,
  };
}

export function buildAppMap(input: BuildAppMapInput): AppMap {
  const { url, viewport, extraction } = input;

  const elements: IdentifiedElement[] = extraction.elements.map((raw, index) => ({
    id: `elem-${index + 1}`,
    raw,
  }));

  const { links, labels, totalUnique } = filterInternalLinks(extraction.links, url);

  return AppMapSchema.parse({
    url,
    title: extraction.title,
    crawledAt: new Date().toISOString(),
    viewport,
    elements: elements.map(({ id, raw }) => ({ id, ...raw })),
    forms: buildForms(extraction.forms, elements),
    discoveredLinks: links,
    discoveredLinkLabels: labels,
    discoveredLinkTotal: totalUnique,
    totalElementsFound: extraction.totalFound,
    isTruncated: extraction.truncated,
  });
}
