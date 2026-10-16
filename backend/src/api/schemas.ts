import { z } from 'zod';
import { MAX_BATCH_URLS } from '../agent/batch.ts';

export const CrawlRequestSchema = z.object({
  url: z.string().trim().min(1, 'URL is required'),
});

export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;

// POST /api/generate accepts exactly one of { url } (single, unchanged
// response shape) or { urls } (batch). Both branches are strict so a body
// carrying both fields is rejected instead of silently dropping one.
export const GenerateRequestSchema = z.union([
  z.object({
    url: z.string().trim().min(1, 'URL is required'),
    altcha: z.string().optional(),
  }).strict(),
  z.object({
    urls: z.array(z.string().trim().min(1, 'URL is required')).min(1).max(MAX_BATCH_URLS),
    altcha: z.string().optional(),
  }).strict(),
]);

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;