import type { DetectionSignal, ElementType } from '../types.ts';
import type { RawElement, RawPageExtraction, RawSelectors } from '../rawTypes.ts';

export interface ExtractElementsOptions {
  maxElements: number;
}

export type ElementsExtraction = Pick<
  RawPageExtraction,
  'elements' | 'links' | 'totalFound' | 'truncated'
>;

interface Candidate {
  element: HTMLElement;
  signal: DetectionSignal;
  isVisible: boolean;
}

interface TestAttribute {
  attribute: string;
  value: string;
}

// RUNS INSIDE THE BROWSER via page.evaluate()
export function extractElements(options: ExtractElementsOptions): ElementsExtraction {
  const INTERACTIVE_ARIA_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton', 'treeitem',
  ]);
  const TEST_ID_ATTRIBUTES = ['data-testid', 'data-test', 'data-cy', 'data-test-id'];
  const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);
  const TEXTBOX_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url']);
  const MAX_TEXT_LENGTH = 100;

  const normalizeText = (raw: string | null | undefined): string | null => {
    const collapsed = (raw ?? '').replace(/\s+/g, ' ').trim();
    return collapsed === '' ? null : collapsed.slice(0, MAX_TEXT_LENGTH);
  };

  const getExplicitRole = (el: HTMLElement): string | null => {
    const rawRole = el.getAttribute('role');
    if (!rawRole) return null;
    return rawRole.trim().split(/\s+/)[0].toLowerCase() || null;
  };

  const getImplicitRole = (el: HTMLElement): string | null => {
    if (el instanceof HTMLAnchorElement) return el.hasAttribute('href') ? 'link' : null;
    if (el instanceof HTMLButtonElement) return 'button';
    if (el instanceof HTMLSelectElement) return 'combobox';
    if (el instanceof HTMLTextAreaElement) return 'textbox';
    if (el instanceof HTMLInputElement) {
      if (BUTTON_INPUT_TYPES.has(el.type)) return 'button';
      if (el.type === 'checkbox' || el.type === 'radio') return el.type;
      if (el.type === 'range') return 'slider';
      if (el.type === 'number') return 'spinbutton';
      if (el.type === 'search') return 'searchbox';
      if (TEXTBOX_INPUT_TYPES.has(el.type)) return 'textbox';
    }
    return null;
  };

  const isFormControl = (el: HTMLElement): boolean =>
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement;

  const getVisibleText = (el: HTMLElement): string | null => {
    if (el instanceof HTMLInputElement) {
      return BUTTON_INPUT_TYPES.has(el.type) ? normalizeText(el.value) : null;
    }
    if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return null;
    return normalizeText(el.innerText);
  };

  const getLabelText = (el: HTMLElement): string | null => {
    const ariaLabel = normalizeText(el.getAttribute('aria-label'));
    if (ariaLabel) return ariaLabel;
    if (isFormControl(el)) {
      const firstLabel = (el as HTMLInputElement).labels?.[0];
      if (firstLabel) return normalizeText(firstLabel.innerText);
    }
    const labelledById = el.getAttribute('aria-labelledby')?.split(/\s+/)[0];
    if (labelledById) return normalizeText(document.getElementById(labelledById)?.innerText);
    return null;
  };

  const getCurrentValue = (el: HTMLElement): string | null => {
    // Never capture password values: this data is sent to a third-party LLM
    if (el instanceof HTMLInputElement) return el.type === 'password' ? null : el.value || null;
    if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return el.value || null;
    return null;
  };

  const findTestAttribute = (el: HTMLElement): TestAttribute | null => {
    for (const attribute of TEST_ID_ATTRIBUTES) {
      const value = el.getAttribute(attribute);
      if (value) return { attribute, value };
    }
    return null;
  };

  const checkIsVisible = (el: HTMLElement): boolean => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };

  // ":disabled" also matches controls disabled through a parent <fieldset disabled>
  const checkIsEnabled = (el: HTMLElement): boolean =>
    !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true';

  const checkIsReadOnly = (el: HTMLElement): boolean => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.readOnly;
    return el.getAttribute('aria-readonly') === 'true';
  };

  const checkIsSubmitControl = (el: HTMLElement): boolean =>
    (el instanceof HTMLButtonElement && el.type === 'submit') ||
    (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image'));

  const findOwningForm = (el: HTMLElement): HTMLFormElement | null => {
    if (
      el instanceof HTMLInputElement || el instanceof HTMLButtonElement ||
      el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
    ) {
      return el.form;
    }
    return el.closest('form');
  };

  // detection layers 

  const isNativeInteractive = (el: HTMLElement): boolean => {
    if (el instanceof HTMLAnchorElement) return el.hasAttribute('href');
    if (el instanceof HTMLInputElement) return el.type !== 'hidden';
    if (
      el instanceof HTMLButtonElement || el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement || el.tagName === 'SUMMARY'
    ) {
      return true;
    }
    const editable = el.getAttribute('contenteditable');
    return editable === '' || editable === 'true' || editable === 'plaintext-only';
  };

  // Only the outermost pointer element counts: cursor is inherited, so children are skipped
  const hasOwnPointerCursor = (el: HTMLElement): boolean => {
    if (getComputedStyle(el).cursor !== 'pointer') return false;
    const parent = el.parentElement;
    return parent === null || getComputedStyle(parent).cursor !== 'pointer';
  };

  const detectSignal = (el: HTMLElement): DetectionSignal | null => {
    if (isNativeInteractive(el)) return 'native';
    const role = getExplicitRole(el);
    if (role !== null && INTERACTIVE_ARIA_ROLES.has(role)) return 'aria';
    if (el.hasAttribute('tabindex') && el.tabIndex >= 0) return 'tabindex';
    if (hasOwnPointerCursor(el)) return 'cursor-pointer';
    return null;
  };

  const classifyElementType = (el: HTMLElement): ElementType => {
    if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) return 'link';
    if (el instanceof HTMLButtonElement) return 'button';
    if (el instanceof HTMLSelectElement) return 'select';
    if (el instanceof HTMLTextAreaElement) return 'textarea';
    if (el instanceof HTMLInputElement) {
      if (BUTTON_INPUT_TYPES.has(el.type)) return 'button';
      if (el.type === 'checkbox') return 'checkbox';
      if (el.type === 'radio') return 'radio';
      return 'input';
    }
    return 'custom_interactive';
  };

  // selector building

  const quoteCssString = (value: string): string =>
    `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

  const countMatches = (selector: string): number => {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  };

  const buildStructuralPath = (el: HTMLElement): string => {
    const segments: string[] = [];
    let current: Element | null = el;
    while (current !== null && current !== document.body) {
      const node: Element = current;
      const idSelector = `#${CSS.escape(node.id)}`;
      if (node.id && countMatches(idSelector) === 1) {
        segments.unshift(idSelector);
        return segments.join(' > ');
      }
      const tag = node.tagName.toLowerCase();
      const sameTagSiblings = Array.from(node.parentElement?.children ?? []).filter(
        (sibling) => sibling.tagName === node.tagName,
      );
      segments.unshift(
        sameTagSiblings.length > 1 ? `${tag}:nth-of-type(${sameTagSiblings.indexOf(node) + 1})` : tag,
      );
      current = node.parentElement;
    }
    return ['body', ...segments].join(' > ');
  };

  const buildCssSelector = (el: HTMLElement, testAttribute: TestAttribute | null): string => {
    const candidates: string[] = [];
    if (el.id) candidates.push(`#${CSS.escape(el.id)}`);
    if (testAttribute) {
      candidates.push(`[${testAttribute.attribute}=${quoteCssString(testAttribute.value)}]`);
    }
    const nameAttribute = el.getAttribute('name');
    if (nameAttribute) {
      candidates.push(`${el.tagName.toLowerCase()}[name=${quoteCssString(nameAttribute)}]`);
    }
    return candidates.find((candidate) => countMatches(candidate) === 1) ?? buildStructuralPath(el);
  };

  const buildLocatorCall = (method: string, value: string): string =>
    `${method}(${JSON.stringify(value)})`;

  // element assembly

  const buildRawElement = (candidate: Candidate, forms: HTMLFormElement[]): RawElement => {
    const { element: el, signal, isVisible } = candidate;
    const role = getExplicitRole(el) ?? getImplicitRole(el);
    const text = getVisibleText(el);
    const labelText = getLabelText(el);
    const placeholder = el.getAttribute('placeholder');
    const testAttribute = findTestAttribute(el);
    const accessibleName = labelText ?? text ?? normalizeText(placeholder);
    const formControl = isFormControl(el);
    const owningForm = findOwningForm(el);
    const formPosition = owningForm ? forms.indexOf(owningForm) : -1;

    const selectors: RawSelectors = {
      getByTestId:
        testAttribute?.attribute === 'data-testid'
          ? buildLocatorCall('getByTestId', testAttribute.value)
          : null,
      getByRole:
        role && accessibleName
          ? `getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(accessibleName)} })`
          : null,
      getByPlaceholder: placeholder ? buildLocatorCall('getByPlaceholder', placeholder) : null,
      getByLabel: formControl && labelText ? buildLocatorCall('getByLabel', labelText) : null,
      getByText: !formControl && text ? buildLocatorCall('getByText', text) : null,
      css: buildCssSelector(el, testAttribute),
    };

    return {
      tagName: el.tagName,
      type: classifyElementType(el),
      detectedBy: signal,
      inputType: el instanceof HTMLInputElement ? el.type : null,
      text,
      name: el.getAttribute('name'),
      placeholder,
      ariaLabel: el.getAttribute('aria-label'),
      ariaRole: role,
      testId: testAttribute?.value ?? null,
      value: getCurrentValue(el),
      href: el instanceof HTMLAnchorElement ? el.href : null,
      isVisible,
      isEnabled: checkIsEnabled(el),
      isRequired: el.matches(':required') || el.getAttribute('aria-required') === 'true',
      isReadOnly: checkIsReadOnly(el),
      isSubmitControl: checkIsSubmitControl(el),
      formIndex: formPosition >= 0 ? formPosition : null,
      selectors,
    };
  };

  const collectCandidates = (): Candidate[] => {
    const candidates: Candidate[] = [];
    for (const node of Array.from(document.body.querySelectorAll('*'))) {
      if (!(node instanceof HTMLElement)) continue;
      const signal = detectSignal(node);
      if (signal === null) continue;
      candidates.push({ element: node, signal, isVisible: checkIsVisible(node) });
    }
    return candidates;
  };

  // main

  const candidates = collectCandidates();
  const visibleFirst = [
    ...candidates.filter((candidate) => candidate.isVisible),
    ...candidates.filter((candidate) => !candidate.isVisible),
  ];
  const forms = Array.from(document.forms);

  return {
    elements: visibleFirst
      .slice(0, options.maxElements)
      .map((candidate) => buildRawElement(candidate, forms)),
    links: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map((a) => a.href),
    totalFound: candidates.length,
    truncated: candidates.length > options.maxElements,
  };
}