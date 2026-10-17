import { z } from 'zod';
import { MAX_URLS_PER_RUN } from '../agent/run.config.ts';

export const CrawlRequestSchema = z.object({
  url: z.string().trim().min(1, 'URL is required'),
});

export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;

// POST /api/generate accepts exactly one of { url } or { urls } (multi-page
// run group). Both branches are strict so a body carrying both fields is
// rejected instead of silently dropping one. Both respond 202 { jobIds }.
export const GenerateRequestSchema = z.union([
  z.object({
    url: z.string().trim().min(1, 'URL is required'),
    altcha: z.string().optional(),
  }).strict(),
  z.object({
    urls: z.array(z.string().trim().min(1, 'URL is required')).min(1).max(MAX_URLS_PER_RUN),
    altcha: z.string().optional(),
  }).strict(),
]);

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;