import type { RawElement, RawForm, RawPageExtraction } from './rawTypes.ts';
import { AppMapSchema, type AppMap, type ElementType, type Form, type FormPurpose } from './types.ts';

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
  return rawForms.map((rawForm, formIndex) => {
    const members = elements.filter(({ raw }) => raw.formIndex === formIndex);
    const fields = members.filter(({ raw }) => FORM_FIELD_TYPES.has(raw.type));
    const submitControl = members.find(({ raw }) => raw.isSubmitControl);

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
}

export function filterInternalLinks(links: string[], pageUrl: string): string[] {
  const pageLocation = new URL(pageUrl);
  const currentPage = new URL(pageUrl);
  currentPage.hash = '';

  const uniqueLinks = new Set<string>();
  for (const link of links) {
    let parsed: URL;
    try {
      parsed = new URL(link, pageLocation);
    } catch {
      continue;
    }
    // mailto:, javascript: and tel: links have the origin "null", so they never match
    if (parsed.origin !== pageLocation.origin) continue;
    parsed.hash = '';
    if (parsed.href === currentPage.href) continue;
    uniqueLinks.add(parsed.href);
  }
  return [...uniqueLinks];
}

export function buildAppMap(input: BuildAppMapInput): AppMap {
  const { url, viewport, extraction } = input;

  const elements: IdentifiedElement[] = extraction.elements.map((raw, index) => ({
    id: `elem-${index + 1}`,
    raw,
  }));

  return AppMapSchema.parse({
    url,
    title: extraction.title,
    crawledAt: new Date().toISOString(),
    viewport,
    // Zod strips keys not in the schema (isSubmitControl, formIndex), so they don't reach the LLM
    elements: elements.map(({ id, raw }) => ({ id, ...raw })),
    forms: buildForms(extraction.forms, elements),
    discoveredLinks: filterInternalLinks(extraction.links, url),
    totalElementsFound: extraction.totalFound,
    isTruncated: extraction.truncated,
  });
}