import { z } from 'zod';
import { MAX_AI_TEST_CASES } from '../run.config.ts';

export const PlanStepActionSchema = z.enum([
  'click', 'dblclick', 'fill', 'navigate',
  'check', 'uncheck', 'reload', 'go_back',
  'assert_visible', 'assert_hidden', 'assert_text', 'assert_value',
  'assert_checked', 'assert_unchecked', 'assert_enabled', 'assert_disabled',
  'assert_url', 'assert_title', 'assert_count',
  'select', 'press', 'hover',
]);
export type PlanStepAction = z.infer<typeof PlanStepActionSchema>;

export const PlanStepTargetSchema = z.object({
  role: z.enum([
    'button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'listitem', 'row', 'heading',
    'dialog', 'alert', 'status', 'tab', 'menuitem', 'option', 'img', 'switch', 'cell',
  ]),
  name: z.string().max(80).optional(),
  withinText: z.string().max(80).optional(),
  container: z.enum(['listitem', 'row', 'article', 'dialog', 'form']).optional(),
});
export type PlanStepTarget = z.infer<typeof PlanStepTargetSchema>;

export const PlanStepSchema = z.object({
  action: PlanStepActionSchema,
  elementId: z.string().nullable(), // Must match an element ID from the App Map, or null
  target: PlanStepTargetSchema.optional().nullable(),
  value: z.string().nullable(),     // Text to fill, text to assert, or URL path
  description: z.string(),          // Human-readable action description
}).superRefine((step, ctx) => {
  const { action, elementId, target, value } = step;

  if (elementId && target) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'elementId and target are mutually exclusive',
      path: ['target'],
    });
  }

  const hasTargetOrElement = Boolean(elementId || target);

  switch (action) {
    case 'click':
    case 'dblclick':
    case 'hover':
      if (!hasTargetOrElement && !value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${action} requires elementId, target, or value (text)`,
          path: ['elementId'],
        });
      }
      break;

    case 'check':
    case 'uncheck':
      if (!hasTargetOrElement) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${action} requires elementId or target`,
          path: ['elementId'],
        });
      }
      break;

    case 'fill':
      if (!hasTargetOrElement) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'fill requires elementId or target',
          path: ['elementId'],
        });
      }
      if (value === null || value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'fill requires value (can be empty string "")',
          path: ['value'],
        });
      }
      break;

    case 'select':
    case 'press':
      if (!hasTargetOrElement) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${action} requires elementId or target`,
          path: ['elementId'],
        });
      }
      if (!value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${action} requires value`,
          path: ['value'],
        });
      }
      break;

    case 'navigate':
      if (!value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'navigate requires value',
          path: ['value'],
        });
      }
      break;

    case 'reload':
    case 'go_back':
      if (elementId || target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${action} does not take an element or target`,
          path: ['elementId'],
        });
      }
      if (value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${action} does not take a value`,
          path: ['value'],
        });
      }
      break;

    case 'assert_visible':
    case 'assert_hidden':
      if (!hasTargetOrElement && !value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${action} requires elementId, target, or value (text)`,
          path: ['elementId'],
        });
      }
      break;

    case 'assert_text':
      if (!hasTargetOrElement) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'assert_text requires elementId or target',
          path: ['elementId'],
        });
      }
      if (!value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'assert_text requires value',
          path: ['value'],
        });
      }
      break;

    case 'assert_value':
      if (!hasTargetOrElement) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'assert_value requires elementId or target',
          path: ['elementId'],
        });
      }
      if (value === null || value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'assert_value requires value (can be empty string "")',
          path: ['value'],
        });
      }
      break;

    case 'assert_checked':
    case 'assert_unchecked':
    case 'assert_enabled':
    case 'assert_disabled':
      if (!hasTargetOrElement) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${action} requires elementId or target`,
          path: ['elementId'],
        });
      }
      break;

    case 'assert_url':
    case 'assert_title':
      if (!value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${action} requires value`,
          path: ['value'],
        });
      }
      break;

    case 'assert_count':
      if (!target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'assert_count requires target',
          path: ['target'],
        });
      }
      if (!value || !/^\d{1,3}$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'assert_count requires numeric count value (1-3 digits)',
          path: ['value'],
        });
      }
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
  origin: z.enum(['llm', 'baseline']).optional().default('llm'),
}).transform((tc) => ({
  ...tc,
  origin: 'llm' as const, // strip any origin the LLM sends; default 'llm'
}));
export type TestCase = {
  id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  origin?: 'llm' | 'baseline';
};

export const TestPlanSchema = z.object({
  testCases: z.array(TestCaseSchema).min(1, 'Test plan must contain at least one test case'),
});
export type TestPlan = {
  testCases: TestCase[];
};

// Prompt templates

export const PLANNER_SYSTEM_PROMPT = `\
You are a Senior QA Automation Architect specializing in writing robust, \
maintainable E2E test suites with Playwright.

Your task: You will be given an "App Map" — a structured JSON representation \
of a web application page, including all interactive elements (buttons, inputs, \
links, forms, etc.) and their exact IDs.
Field legend: role=ariaRole, label=ariaLabel, disabled=!isEnabled, hidden=!isVisible, required=isRequired, readOnly=isReadOnly.

Analyze the App Map and produce a comprehensive Test Plan consisting of \
high-value test cases that cover the most critical user journeys.
Return 5–${MAX_AI_TEST_CASES} test cases, highest value first, written the way a production QA suite would be. Cover what the App Map supports:
(1) the primary happy path end to end; (2) validation / negative paths (empty or invalid input; assert the app did NOT advance:
URL unchanged, field still visible, or value kept); (3) state changes verified with state assertions (assert_value, assert_checked,
assert_count, assert_hidden), not just visibility; (4) persistence: reload, then re-assert the state; (5) every distinct form;
(6) at most ONE test that only checks link navigation. Prefer two or more assertions per test. Only pages with three or fewer
interactive elements may return fewer than 5.

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
          "action": "click|dblclick|fill|navigate|check|uncheck|reload|go_back|assert_visible|assert_hidden|assert_text|assert_value|assert_checked|assert_unchecked|assert_enabled|assert_disabled|assert_url|assert_title|assert_count|select|press|hover",
          "elementId": "elem-N or null",
          "target": { "role": "button|link|checkbox|radio|textbox|combobox|listitem|row|heading|dialog|alert|status|tab|menuitem|option|img|switch|cell", "name": "optional name", "withinText": "optional text filter", "container": "listitem|row|article|dialog|form" } or null,
          "value": "string value or null",
          "description": "Human readable description of this step"
        }
      ]
    }
  ]
}

## STRICT RULES — FOLLOW WITHOUT EXCEPTION
1. Every step that targets an interactive element MUST use the EXACT id from \
the App Map (e.g., "elem-3") or a "target" object. Do NOT invent element IDs. elementId and target are mutually exclusive.
2. If an action does not target a specific element (e.g., a navigate, reload, or go_back step), \
set elementId to null and target to null.
3. Every test case MUST end with an assertion step that validates the objective of the test. Prefer two or more assertions per test.
4. Prioritize user journeys: form submissions, validation paths, state changes, reload persistence, critical interactions.
5. Keep each test case focused on a single user objective.
6. value must be null when the action does not require a value.
7. SNAPSHOT CAVEAT: The App Map is a pre-interaction snapshot. Elements that appear \
only after an action (toast messages, newly-added list items, modals, success \
banners) are NOT in the App Map.
8. TEXT PROVENANCE: The value in any assertion step must come from one of these \
sources only: (a) text you typed in a prior fill step, (b) text already present \
in the App Map (element text, label, placeholder), or (c) a URL path derived \
from an element's href. Never invent application messages or UI copy that is not in the App Map.
9. FORM SUBMISSION WITHOUT BUTTON: When a form has no submit button \
(submitButtonId is null), submit it by adding a press step with value "Enter" \
targeting the last filled input element.
10. NAVIGATION: Every test automatically starts on the crawled page. Do NOT add \
a leading navigate step. Use navigate ONLY if a step explicitly leaves the current \
page, using an absolute URL found in discoveredLinks.
11. HIDDEN: elements with hidden:true exist but are not visible yet; use them only after a step that reveals them.
12. TARGET: for elements that appear only after an action (snapshot caveat), use "target" {role, name?, withinText?, container?} \
instead of elementId. name/withinText follow the TEXT PROVENANCE rule (typically text you typed in a fill step). \
Example: after filling "Buy milk" and pressing Enter → \
{"action":"check","elementId":null,"target":{"role":"checkbox","container":"listitem","withinText":"Buy milk"},"value":null,"description":"Check Buy milk"}
13. assert_count value is a number as a string, e.g. "2".`;

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
          "action": "click|dblclick|fill|navigate|check|uncheck|reload|go_back|assert_visible|assert_hidden|assert_text|assert_value|assert_checked|assert_unchecked|assert_enabled|assert_disabled|assert_url|assert_title|assert_count|select|press|hover",
          "elementId": "elem-id-or-null",
          "target": null,
          "value": "string-value-or-null",
          "description": "Human readable action step"
        }
      ]
    }
  ]
}`;
}

// Module component implementation.
