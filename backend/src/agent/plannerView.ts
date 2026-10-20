import type { AppMap } from '../crawler/types.ts';

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

export function toPlannerView(appMap: AppMap, options?: PlannerViewOptions): PlannerView {
  const keepHidden = options?.keepHiddenIds
    ? options.keepHiddenIds instanceof Set
      ? options.keepHiddenIds
      : new Set(options.keepHiddenIds)
    : undefined;

  const elements: PlannerElementView[] = [];
  const emittedIds = new Set<string>();

  for (const el of appMap.elements) {
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
      href: el.href ?? undefined,
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
      href: el.href ?? undefined,
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

  return {
    url: appMap.url,
    title: appMap.title,
    elements,
    forms,
    discoveredLinks: (appMap.discoveredLinks ?? []).slice(0, 25),
  };
}
// Module component implementation.
