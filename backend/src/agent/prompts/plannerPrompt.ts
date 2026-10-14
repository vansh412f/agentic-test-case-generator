import { z } from 'zod';

export const PlanStepActionSchema = z.enum([
  'click',
  'fill',
  'navigate',
  'assert_visible',
  'assert_text',
  'select',
  'hover',
]);
export type PlanStepAction = z.infer<typeof PlanStepActionSchema>;

export const PlanStepSchema = z.object({
  action: PlanStepActionSchema,
  elementId: z.string().nullable(), // Must match an element ID from the App Map, or null
  value: z.string().nullable(),     // Text to fill, text to assert, or URL path
  description: z.string(),          // Human-readable action description
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const TestCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  targetPage: z.string(), // The page path targeted (e.g., "/login")
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
      "targetPage": "/path-to-page",
      "steps": [
        {
          "action": "click|fill|navigate|assert_visible|assert_text|select|hover",
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
3. Every test case MUST end with an assertion step (assert_visible or \
assert_text) that validates the objective of the test.
4. Prioritize user journeys: form submissions, login/signup flows, critical \
button interactions, navigation. Ignore static decorative elements.
5. Keep each test case focused on a single user objective.
6. value must be null when the action does not require a value \
(e.g., click, hover, assert_visible on an element).`;

export function buildPlannerUserPrompt(appMapJson: string): string {
  return `Here is the App Map JSON of the target application. Analyze it and \
generate a complete structured Test Plan of high-value test cases:

${appMapJson}

Remember to output exactly a JSON object conforming to the schema:
{
  "testCases": [
    {
      "id": "tc-1",
      "title": "Title of test case",
      "description": "Short description of target journey",
      "targetPage": "/path",
      "steps": [
        {
          "action": "click|fill|navigate|assert_visible|assert_text|select|hover",
          "elementId": "elem-id-or-null",
          "value": "string-value-or-null",
          "description": "Human readable action step"
        }
      ]
    }
  ]
}`;
}
