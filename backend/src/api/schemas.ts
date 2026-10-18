import { z } from 'zod';
import { MAX_URLS_PER_RUN } from '../agent/run.config.ts';

export const CrawlRequestSchema = z.object({
  url: z.string().trim().min(1, 'URL is required'),
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

// POST /api/generate accepts exactly one of { url } or { urls } (multi-page
// run group). Both branches are strict so a body carrying both fields is
// rejected instead of silently dropping one. Both respond 202 { jobIds }.
export const GenerateRequestSchema = z.union([
  z.object({
    url: z.string().trim().min(1, 'URL is required'),
    deepCrawl: z.boolean().optional(),
    webhookUrl,
    altcha: z.string().optional(),
    testData: z.array(TestDataEntrySchema).max(30).optional(),
    focus: z.array(ElementRef).min(1).max(5).optional(),
  }).strict(),
  z.object({
    urls: z.array(z.string().trim().min(1, 'URL is required')).min(1).max(MAX_URLS_PER_RUN),
    webhookUrl,
    altcha: z.string().optional(),
    testData: z.array(TestDataEntrySchema).max(30).optional(),
    focus: z.array(ElementRef).min(1).max(5).optional(),
  }).strict(),
]);

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;