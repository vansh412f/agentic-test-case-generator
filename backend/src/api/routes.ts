import { Router } from 'express';
import { ZodError } from 'zod';
import { CrawlRequestSchema } from './schemas.ts';
import { crawlPage } from '../crawler/pageCrawler.ts';
import { CrawlError, type CrawlErrorCode } from '../crawler/crawlErrors.ts';
import { LlmError } from '../llm/types.ts';
import type { LlmErrorCode } from '../llm/types.ts';
import { runPipeline } from '../agent/pipeline.ts';

const router = Router();

const CRAWL_ERROR_STATUS: Record<CrawlErrorCode, number> = {
  INVALID_URL: 400,
  NAVIGATION_TIMEOUT: 504,
  NAVIGATION_FAILED: 502,
  EXTRACTION_FAILED: 500,
};

const LLM_ERROR_STATUS: Record<LlmErrorCode, number> = {
  RATE_LIMITED: 429,
  AUTH_FAILED: 502,
  TIMEOUT: 504,
  BAD_RESPONSE: 502,
  PROVIDER_UNAVAILABLE: 503,
  ALL_PROVIDERS_FAILED: 503,
};

router.post('/crawl', async (req, res) => {
  try {
    const { url } = CrawlRequestSchema.parse(req.body);
    const appMap = await crawlPage(url);    
    res.json(appMap);
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'Validation failed',
        details: err.flatten().fieldErrors,
      });
      return;
    }

    if (err instanceof CrawlError) {
      const status = CRAWL_ERROR_STATUS[err.code];
      res.status(status).json({
        error: err.message,
        code: err.code,
      });
      return;
    }

    throw err;
  }
});

router.post('/generate', async (req, res) => {
  const parsed = CrawlRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'INVALID_REQUEST',
      message: parsed.error.issues.map((i) => i.message).join('; '),
    });
    return;
  }

  const { url } = parsed.data;

  try {
    const result = await runPipeline(url);
    res.json(result);
  } catch (err) {
    if (err instanceof LlmError) {
      const status = LLM_ERROR_STATUS[err.code];
      res.status(status).json({
        error: err.code,
        message: err.message,
      });
      return;
    }
    if (err instanceof CrawlError) {
      const status = CRAWL_ERROR_STATUS[err.code];
      res.status(status).json({
        error: err.code,
        message: err.message,
      });
      return;
    }
    throw err;
  }
});

export default router;