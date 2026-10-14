import { Router } from 'express';
import { CrawlRequestSchema } from './schemas.ts';
import { crawlPage } from '../crawler/pageCrawler.ts';
import { runPipeline } from '../agent/pipeline.ts';
import { toHttpError } from './errors.ts';

const router = Router();

router.post('/crawl', async (req, res) => {
  const parsed = CrawlRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'Request validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const appMap = await crawlPage(parsed.data.url);
    res.json(appMap);
  } catch (err) {
    const httpErr = toHttpError(err);
    if (httpErr) {
      res.status(httpErr.status).json(httpErr.body);
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
      message: 'Request validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const result = await runPipeline(parsed.data.url);
    res.json(result);
  } catch (err) {
    const httpErr = toHttpError(err);
    if (httpErr) {
      res.status(httpErr.status).json(httpErr.body);
      return;
    }
    throw err;
  }
});

export default router;