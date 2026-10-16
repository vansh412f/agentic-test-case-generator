import { Router } from 'express';
import jobsRouter from './jobsRoutes.ts';
import { CrawlRequestSchema, GenerateRequestSchema } from './schemas.ts';
import { crawlPage } from '../crawler/pageCrawler.ts';
import { runPipeline } from '../agent/pipeline.ts';
import { runBatch } from '../agent/batch.ts';
import { toHttpError } from './errors.ts';

const router = Router();
router.use('/jobs', jobsRouter);

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
  const parsed = GenerateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'Request validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    // Batch always responds 200 with per-URL outcomes (allSettled
    // semantics); single mode keeps its original shape and error mapping.
    if ('urls' in parsed.data) {
      res.json(await runBatch(parsed.data.urls, (url) => runPipeline(url)));
      return;
    }
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