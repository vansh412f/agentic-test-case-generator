import type { AppMap } from '../crawler/types.ts';
import { isSkipLink } from '../crawler/appMapBuilder.ts';

export interface PlannerViewOptions {
  keepHiddenIds?: Set<string> | Iterable<string>;
}

export interface PlannerElementView {
  id: string;
  type: string;
  inputType?: string;
  role?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  name?: string;
  testId?: string;
  value?: string;
  href?: string;
  required?: true;
  disabled?: true;
  readOnly?: true;
  hidden?: true;
}

export interface PlannerFormView {
  id: string;
  purpose: string;
  fieldIds: string[];
  submitButtonId?: string;
}

export interface PlannerView {
  url: string;
  title: string;
  elements: PlannerElementView[];
  forms: PlannerFormView[];
  discoveredLinks: string[];
}

function clip(val: string | null | undefined): string | undefined {
  if (val === null || val === undefined) return undefined;
  const trimmed = val.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
}

export function compactHref(val: string | null | undefined, baseUrl: string): string | undefined {
  if (val === null || val === undefined) return undefined;
  const trimmed = val.trim();
  if (trimmed.length === 0) return undefined;

  // Fast-path preservation for normal, hash, and short URLs
  if (trimmed.length <= 120) return trimmed;

  // When length > 120 (e.g. tracking query strings on e-commerce sites):
  try {
    const u = new URL(trimmed, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return undefined;
    }
    const hashPart = u.hash && u.hash.startsWith('#/') ? u.hash.slice(0, 80) : '';
    const clean = `${u.origin}${u.pathname}${hashPart}`;
    return clean.length <= 160 ? clean : undefined;
  } catch {
    return undefined;
  }
}

export function toPlannerView(appMap: AppMap, options?: PlannerViewOptions): PlannerView {
  const keepHidden = options?.keepHiddenIds
    ? options.keepHiddenIds instanceof Set
      ? options.keepHiddenIds
      : new Set(options.keepHiddenIds)
    : undefined;

  const elements: PlannerElementView[] = [];
  const emittedIds = new Set<string>();

  for (const el of appMap.elements) {
    if (isSkipLink(el)) {
      continue;
    }
    if (el.isVisible === false && (!keepHidden || !keepHidden.has(el.id))) {
      continue;
    }

    const item: PlannerElementView = {
      id: el.id,
      type: el.type,
      inputType: el.inputType ?? undefined,
      role: el.ariaRole ?? undefined,
      text: clip(el.text),
      label: clip(el.ariaLabel),
      placeholder: clip(el.placeholder),
      name: el.name ?? undefined,
      testId: el.testId ?? undefined,
      value: clip(el.value),
      href: compactHref(el.href, appMap.url),
      required: el.isRequired ? true : undefined,
      disabled: !el.isEnabled ? true : undefined,
      readOnly: el.isReadOnly ? true : undefined,
      hidden: el.isVisible === false ? true : undefined,
    };

    elements.push(item);
    emittedIds.add(el.id);
  }

  let hiddenAdded = 0;
  for (const el of appMap.elements) {
    if (hiddenAdded >= 25) break;
    if (emittedIds.has(el.id)) continue;
    if (isSkipLink(el)) continue;
    if (el.isVisible !== false) continue;

    const text = clip(el.text);
    const label = clip(el.ariaLabel);
    const placeholder = clip(el.placeholder);

    if (!text && !label && !placeholder) continue;

    const item: PlannerElementView = {
      id: el.id,
      type: el.type,
      inputType: el.inputType ?? undefined,
      role: el.ariaRole ?? undefined,
      text,
      label,
      placeholder,
      name: el.name ?? undefined,
      testId: el.testId ?? undefined,
      value: clip(el.value),
      href: compactHref(el.href, appMap.url),
      required: el.isRequired ? true : undefined,
      disabled: !el.isEnabled ? true : undefined,
      readOnly: el.isReadOnly ? true : undefined,
      hidden: true,
    };

    elements.push(item);
    emittedIds.add(el.id);
    hiddenAdded++;
  }

  const forms: PlannerFormView[] = (appMap.forms ?? []).map((form) => {
    const fieldIds = form.fieldIds.filter((id) => emittedIds.has(id));
    const submitButtonId =
      form.submitButtonId && emittedIds.has(form.submitButtonId)
        ? form.submitButtonId
        : undefined;

    return {
      id: form.id,
      purpose: form.purpose,
      fieldIds,
      submitButtonId,
    };
  });

  const discoveredLinks = Array.from(
    new Set(
      (appMap.discoveredLinks ?? [])
        .map((link) => compactHref(link, appMap.url))
        .filter((l): l is string => Boolean(l)),
    ),
  ).slice(0, 25);

  return {
    url: appMap.url,
    title: appMap.title,
    elements,
    forms,
    discoveredLinks,
  };
}
// Module component implementation.
