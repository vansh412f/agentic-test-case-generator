import { z } from 'zod';

export const targetUrlSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Enter the URL of the application you want to test.')
    .superRefine((value, context) => {
      let parsed: URL;

      try {
        parsed = new URL(value);
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter a complete URL, including http:// or https://.',
        });
        return;
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Only http:// and https:// URLs are supported.',
        });
      }
    }),
});

export type TargetUrlForm = z.infer<typeof targetUrlSchema>;
