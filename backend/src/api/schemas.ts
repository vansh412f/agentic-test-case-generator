import { z } from 'zod';
import { MAX_URLS_PER_RUN } from '../agent/run.config.ts';
import { normalizeTargetUrl } from '../security/targetUrl.ts';
import { config } from '../config.ts';
import { CrawlError } from '../crawler/crawlErrors.ts';

const targetUrlSchema = z
  .string()
  .trim()
  .min(1, 'URL is required')
  .transform((val, ctx) => {
    try {
      return normalizeTargetUrl(val, { localMode: config.LOCAL_AGENT_MODE });
    } catch (err) {
      if (err instanceof CrawlError) {
        ctx.addIssue({
          code: 'custom',
          message: err.message,
          params: { code: err.code, ...(typeof err.details === 'object' && err.details ? (err.details as Record<string, unknown>) : {}) },
        });
        return z.NEVER;
      }
      throw err;
    }
  });

export const CrawlRequestSchema = z.object({
  url: targetUrlSchema,
});

export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;

const webhookUrl = z.string().trim().url('webhookUrl must be an absolute URL').max(2048).optional();

export const ElementRef = z.object({
  elementId: z.string().regex(/^[\w-]{1,40}$/),
  css: z.string().min(1).max(500),
});
export type ElementRef = z.infer<typeof ElementRef>;

export const TestDataEntrySchema = ElementRef.extend({
  value: z.string().max(200),
  sensitive: z.boolean(),
});
export type TestDataEntry = z.infer<typeof TestDataEntrySchema>;

const testDataByUrlSchema = z
  .record(z.string(), z.array(TestDataEntrySchema).max(30))
  .optional()
  .transform((record, ctx) => {
    if (!record) return undefined;
    const normalizedRecord: Record<string, TestDataEntry[]> = {};
    for (const [key, entries] of Object.entries(record)) {
      try {
        const normKey = normalizeTargetUrl(key, { localMode: config.LOCAL_AGENT_MODE });
        normalizedRecord[normKey] = entries;
      } catch (err) {
        if (err instanceof CrawlError) {
          ctx.addIssue({
            code: 'custom',
            message: err.message,
            params: { code: err.code, ...(typeof err.details === 'object' && err.details ? (err.details as Record<string, unknown>) : {}) },
          });
          return z.NEVER;
        }
        throw err;
      }
    }
    return normalizedRecord;
  })
  .refine(
    (record) => !record || Object.keys(record).length <= MAX_URLS_PER_RUN,
    `At most ${MAX_URLS_PER_RUN} keys allowed in testDataByUrl`,
  );

// POST /api/generate accepts exactly one of { url } or { urls } (multi-page
// run group). Both branches are strict so a body carrying both fields is
// rejected instead of silently dropping one. Both respond 202 { jobIds }.
export const GenerateRequestSchema = z.union([
  z
    .object({
      url: targetUrlSchema,
      deepCrawl: z.boolean().optional(),
      webhookUrl,
      altcha: z.string().optional(),
      fresh: z.boolean().optional(),
      testData: z.array(TestDataEntrySchema).max(30).optional(),
      focus: z.array(ElementRef).min(1).max(5).optional(),
    })
    .strict(),
  z
    .object({
      urls: z.array(targetUrlSchema).min(1).max(MAX_URLS_PER_RUN),
      webhookUrl,
      altcha: z.string().optional(),
      fresh: z.boolean().optional(),
      testData: z.array(TestDataEntrySchema).max(30).optional(),
      testDataByUrl: testDataByUrlSchema,
      focus: z.array(ElementRef).min(1).max(5).optional(),
    })
    .strict()
    .refine((data) => {
      if (!data.testDataByUrl) return true;
      const urlSet = new Set(data.urls);
      return Object.keys(data.testDataByUrl).every((k) => urlSet.has(k));
    }, 'Every key in testDataByUrl must be in urls'),
]);

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
// Module component implementation.
