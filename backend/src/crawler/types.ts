import { z } from 'zod';

export const ElementTypeEnum = z.enum([
  'button',
  'input',
  'textarea',
  'select',
  'link',
  'checkbox',
  'radio',
  'custom_interactive',
]);
export type ElementType = z.infer<typeof ElementTypeEnum>;

// Which detection layer discovered the element (used for debugging heuristics)
export const DetectionSignalEnum = z.enum(['native', 'aria', 'tabindex', 'cursor-pointer']);
export type DetectionSignal = z.infer<typeof DetectionSignalEnum>;

// What a form is for, inferred from its fields
export const FormPurposeEnum = z.enum(['login', 'signup', 'search', 'unknown']);
export type FormPurpose = z.infer<typeof FormPurposeEnum>;

// Playwright-friendly locator strategies for an element
export const ElementSelectorMapSchema = z.object({
  getByTestId: z.string().nullable().optional(),
  getByRole: z.string().nullable().optional(),
  getByPlaceholder: z.string().nullable().optional(),
  getByLabel: z.string().nullable().optional(),
  getByText: z.string().nullable().optional(),
  // Always present: the fallback when no semantic locator is available
  css: z.string(),
});
export type ElementSelectorMap = z.infer<typeof ElementSelectorMapSchema>;

// Definition of a single interactive DOM element
export const InteractiveElementSchema = z.object({
  id: z.string().describe('Unique identifier for this element in the App Map, e.g. elem-1'),
  tagName: z.string().describe('HTML tag name, e.g. BUTTON, INPUT, A'),
  type: ElementTypeEnum.describe('Categorized interactive element type'),
  detectedBy: DetectionSignalEnum.describe('Detection layer that found this element'),
  inputType: z.string().nullable().optional().describe('HTML input type, e.g. text, password, email'),
  text: z.string().nullable().optional().describe('Visible text content inside the element'),
  name: z.string().nullable().optional().describe('HTML name attribute'),
  placeholder: z.string().nullable().optional().describe('Placeholder attribute for input fields'),
  ariaLabel: z.string().nullable().optional().describe('Accessibility aria-label if present'),
  ariaRole: z.string().nullable().optional().describe('Accessibility role or native implicit role'),
  testId: z.string().nullable().optional().describe('Value of data-testid, data-test, data-cy attribute'),
  value: z.string().nullable().optional().describe('Current default or prefilled value'),
  href: z.string().nullable().optional().describe('Target link URL for anchor tags'),
  isVisible: z.boolean().describe('Whether the element is currently visible'),
  isEnabled: z.boolean().describe('Whether the element is interactable (not disabled)'),
  isRequired: z.boolean().default(false).describe('Whether the input is marked as required'),
  isReadOnly: z.boolean().default(false).describe('Whether the input is read-only'),
  selectors: ElementSelectorMapSchema.describe('Recommended Playwright selector queries'),
  page: z.number().int().min(2).optional().describe('Deep crawl only: 1-based index into pages. Absent = start page'),
});
export type InteractiveElement = z.infer<typeof InteractiveElementSchema>;

// Grouped form definition for multi-field workflows
export const FormSchema = z.object({
  id: z.string().describe('Form ID or generated form identifier'),
  name: z.string().nullable().optional(),
  action: z.string().nullable().optional(),
  method: z.string().nullable().optional(),
  purpose: FormPurposeEnum.describe('What this form appears to be for'),
  fieldIds: z.array(z.string()).describe('List of InteractiveElement IDs belonging to this form'),
  submitButtonId: z.string().nullable().optional().describe('InteractiveElement ID for the submit button'),
});
export type Form = z.infer<typeof FormSchema>;

// Full structured App Map of a crawled page
export const AppMapSchema = z.object({
  url: z.string().url().describe('The URL that was crawled'),
  title: z.string().describe('The page document title'),
  crawledAt: z.string().datetime().describe('ISO timestamp of when the crawl completed'),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
  }),
  elements: z.array(InteractiveElementSchema).describe('List of all discovered interactive elements'),
  forms: z.array(FormSchema).describe('Grouped forms discovered on the page'),
  discoveredLinks: z.array(z.string()).describe('Internal links discovered on this page for multi-page crawling'),
  pages: z.array(z.object({ url: z.string().url(), requestedUrl: z.string(), title: z.string() }))
    .optional().describe('Deep crawl only: crawled pages in order; pages[0] is the start page'),
  totalElementsFound: z.number().describe('Interactive elements found before the per-page cap was applied'),
  isTruncated: z.boolean().describe('True when the cap dropped some elements from this map'),
});
export type AppMap = z.infer<typeof AppMapSchema>;