import { z } from 'zod';
import { classifyTarget } from './targetUrl';

export const targetUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Enter the URL of the application you want to test.')
    .superRefine((value, context) => {
      const result = classifyTarget(value);

      if (result.kind === 'invalid') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter a valid URL (e.g. https://demo.playwright.dev/todomvc/ or http://localhost:3000).',
        });
      }
    }),
});

export type TargetUrlForm = z.infer<typeof targetUrlSchema>;
