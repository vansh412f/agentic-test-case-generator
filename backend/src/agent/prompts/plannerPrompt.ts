import { z } from 'zod';

export const PlanStepActionSchema = z.enum([
  'click', 'fill', 'navigate',
  'assert_visible', 'assert_text', 'assert_url',
  'select', 'press', 'hover',
]);
export type PlanStepAction = z.infer<typeof PlanStepActionSchema>;

export const PlanStepSchema = z.object({
  action: PlanStepActionSchema,
  elementId: z.string().nullable(), // Must match an element ID from the App Map, or null
  value: z.string().nullable(),     // Text to fill, text to assert, or URL path
  description: z.string(),          // Human-readable action description
}).superRefine((step, ctx) => {
  const { action, elementId, value } = step;

  const requireElement = () => {
    if (!elementId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${action} requires elementId`, path: ['elementId'] });
  };
  const requireValue = () => {
    if (!value) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${action} requires value`, path: ['value'] });
  };
  const requireFillValue = () => {
    if (value === null || value === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fill requires value (can be empty string "")', path: ['value'] });
    }
  };

  switch (action) {
    case 'click':
    case 'hover':
      requireElement();
      break;
    case 'fill':
      requireElement();
      requireFillValue();
      break;
    case 'select':
    case 'press':
      requireElement();
      requireValue();
      break;
    case 'navigate':
      requireValue();
      break;
    case 'assert_visible':
      if (!elementId && !value) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'assert_visible requires at least one of elementId or value', path: ['elementId'] });
      }
      break;
    case 'assert_text':
      requireElement();
      requireValue();
      break;
    case 'assert_url':
      requireValue();
      break;
    default:
      action satisfies never;
  }
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const TestCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  steps: z.array(PlanStepSchema).min(1, 'Each test case must have at least one step'),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const TestPlanSchema = z.object({
  testCases: z.array(TestCaseSchema).min(1, 'Test plan must contain at least one test case'),
});
export type TestPlan = z.infer<typeof TestPlanSchema>;

// Prompt templates

export const PLANNER_SYSTEM_PROMPT = `\
You are a Senior QA Automation Architect specializing in writing robust, \
maintainable E2E test suites with Playwright.

Your task: You will be given an "App Map" — a structured JSON representation \
of a web application page, including all interactive elements (buttons, inputs, \
links, forms, etc.) and their exact IDs.

Analyze the App Map and produce a comprehensive Test Plan consisting of \
high-value test cases that cover the most critical user journeys.

## OUTPUT FORMAT
You MUST respond ONLY with a raw JSON object. No markdown, no code fences, \
no prose before or after — pure JSON only. This is a JSON API.

The JSON object must conform exactly to this structure:
{
  "testCases": [
    {
      "id": "tc-1",
      "title": "Short title of test case",
      "description": "Short description of the user journey being tested",
      "steps": [
        {
          "action": "click|fill|navigate|assert_visible|assert_text|assert_url|select|press|hover",
          "elementId": "elem-N or null",
          "value": "string value or null",
          "description": "Human readable description of this step"
        }
      ]
    }
  ]
}

## STRICT RULES — FOLLOW WITHOUT EXCEPTION
1. Every step that targets an interactive element MUST use the EXACT id from \
the App Map (e.g., "elem-3"). Do NOT invent element IDs.
2. If an action does not target a specific element (e.g., a navigate step), \
set elementId to null.
3. Every test case MUST end with an assertion step (assert_visible, \
assert_text, or assert_url) that validates the objective of the test.
4. Prioritize user journeys: form submissions, login/signup flows, critical \
button interactions, navigation. Ignore static decorative elements.
5. Keep each test case focused on a single user objective.
6. value must be null when the action does not require a value \
(e.g., click, hover, assert_visible on an element).
7. SNAPSHOT CAVEAT: The App Map is a pre-interaction snapshot. Elements that appear \
only after an action (toast messages, newly-added list items, modals, success \
banners) are NOT in the App Map. To assert on post-action content, use \
assert_visible with elementId set to null and the expected text in value.
8. TEXT PROVENANCE: The value in any assertion step must come from one of these \
sources only: (a) text you typed in a prior fill step, (b) text already present \
in the App Map (element text, labels, placeholders), or (c) a URL path derived \
from an element's href. Never invent application messages, success text, error \
labels, or UI copy that is not in the App Map.
9. FORM SUBMISSION WITHOUT BUTTON: When a form has no submit button \
(submitButtonId is null), submit it by adding a press step with value "Enter" \
targeting the last filled input element.
10. NAVIGATION: Every test automatically starts on the crawled page. Do NOT add \
a leading navigate step. Use navigate ONLY if a step explicitly leaves the current \
page, using an absolute URL found in discoveredLinks.`;

const MULTI_PAGE_RULE = `
MULTI-PAGE APP MAP: This App Map covers several pages, listed in "pages" \
(pages[0] is the start page). An element with a "page" field lives on \
pages[page - 1]; an element without it lives on the start page. Before the \
first step that uses an element from a page other than the one the test is \
currently on, add a navigate step whose value is that page's exact "url". \
Only navigate steps change the current page.
`;

export function buildPlannerUserPrompt(appMapJson: string, options: { multiPage?: boolean } = {}): string {
  return `Here is the App Map JSON of the target application. Analyze it and \
generate a complete structured Test Plan of high-value test cases:

${appMapJson}${options.multiPage ? MULTI_PAGE_RULE : ''}

Remember to output exactly a JSON object conforming to the schema:
{
  "testCases": [
    {
      "id": "tc-1",
      "title": "Title of test case",
      "description": "Short description of target journey",
      "steps": [
        {
          "action": "click|fill|navigate|assert_visible|assert_text|assert_url|select|press|hover",
          "elementId": "elem-id-or-null",
          "value": "string-value-or-null",
          "description": "Human readable action step"
        }
      ]
    }
  ]
}`;
}
