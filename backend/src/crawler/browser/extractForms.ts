import type { RawForm } from '../rawTypes.ts';

// RUNS INSIDE THE BROWSER via page.evaluate()

export function extractForms(): RawForm[] {
  return Array.from(document.forms).map((form) => ({
    domId: form.getAttribute('id'),
    name: form.getAttribute('name'),
    action: form.getAttribute('action'),
    // HTML defaults to GET when the method attribute is missing
    method: (form.getAttribute('method') ?? 'get').toLowerCase(),
    ariaRole: form.getAttribute('role'),
  }));
}