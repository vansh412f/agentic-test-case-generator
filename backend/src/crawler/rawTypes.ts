import type { DetectionSignal, ElementType } from './types.ts';

// Locator candidates built inside the browser. null means "not available".
export interface RawSelectors {
  getByTestId: string | null;
  getByRole: string | null;
  getByPlaceholder: string | null;
  getByLabel: string | null;
  getByText: string | null;
  css: string;
}

// One interactive element exactly as the browser reports it (no id yet)
export interface RawElement {
  tagName: string;
  type: ElementType;
  detectedBy: DetectionSignal;
  inputType: string | null;
  text: string | null;
  name: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  ariaRole: string | null;
  testId: string | null;
  value: string | null;
  href: string | null;
  isVisible: boolean;
  isEnabled: boolean;
  isRequired: boolean;
  isReadOnly: boolean;
  // True for <button type="submit"> and <input type="submit"> (used to find a form's submit button)
  isSubmitControl: boolean;
  // Position of the parent <form> in document.forms, or null when outside any form
  formIndex: number | null;
  selectors: RawSelectors;
}

// One <form> as the browser reports it. Array position equals document.forms index.
export interface RawForm {
  domId: string | null;
  name: string | null;
  action: string | null;
  method: string | null;
  // Value of the role attribute (e.g. "search"), used for purpose detection
  ariaRole: string | null;
}

// Everything one browser-side extraction pass returns for a page
export interface RawPageExtraction {
  title: string;
  elements: RawElement[];
  forms: RawForm[];
  // Absolute hrefs of every anchor on the page; filtering to internal links happens in Node
  links: string[];
  // How many interactive elements were found before the per-page cap was applied
  totalFound: number;
  // True when the cap dropped some elements
  truncated: boolean;
}
// Module component implementation.
