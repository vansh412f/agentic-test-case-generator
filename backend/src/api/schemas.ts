import { z } from 'zod';

export const CrawlRequestSchema = z.object({
  url: z.string().trim().min(1, 'URL is required'),
});

export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;