import { Router } from 'express';
import jobsRouter from './jobsRoutes.ts';
import { CrawlRequestSchema, GenerateRequestSchema } from './schemas.ts';
import { crawlPage } from '../crawler/pageCrawler.ts';
import { runPipeline } from '../agent/pipeline.ts';
import { runBatch } from '../agent/batch.ts';
import { toHttpError } from './errors.ts';
import { visitorMiddleware } from './visitorMiddleware.ts';
import {
  generateIpLimiter,
  crawlIpLimiter,
  powChallengeLimiter,
  visitorDailyLimiter,
  byokValidateLimiter,
} from './rateLimits.ts';
import { powService } from '../security/pow.ts';
import { jobsCreatedToday, nextUtcMidnight } from '../security/dailyQuota.ts';
import { pipelineGate, QueueFullError } from '../security/concurrencyGate.ts';
import { withRequestLlmKeys, hasOwnKeys, type RequestLlmKeys } from '../llm/requestKeys.ts';
import { z } from 'zod';
import { config } from '../config.ts';
import { getLifetimeStats } from '../db/jobs.ts';

const router = Router();
router.use(visitorMiddleware);
router.use('/jobs', jobsRouter);

interface CachedStats {
  data: {
    jobsRun: number;
    testCasesGenerated: number;
    testsPassed: number;
    correctionsApplied: number;
    updatedAt: string;
  };
  cachedAt: number;
}

let cachedStats: CachedStats | null = null;

router.get('/stats', async (_req, res) => {
  const now = Date.now();
  if (cachedStats && now - cachedStats.cachedAt < 60_000) {
    res.json(cachedStats.data);
    return;
  }

  try {
    const raw = await getLifetimeStats();
    const data = {
      ...raw,
      updatedAt: new Date().toISOString(),
    };
    cachedStats = { data, cachedAt: now };
    res.json(data);
  } catch (err) {
    const httpErr = toHttpError(err);
    if (httpErr) {
      res.status(httpErr.status).json(httpErr.body);
      return;
    }
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve stats.' });
  }
});

router.get('/pow/challenge', powChallengeLimiter, async (_req, res) => {
  try {
    const challenge = await powService.createChallenge();
    res.json({ challenge, ...(challenge && typeof challenge === 'object' ? challenge : {}) });
  } catch (error) {
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to generate proof-of-work challenge',
    });
  }
});

router.post('/crawl', crawlIpLimiter, async (req, res) => {
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

const ByokValidateSchema = z.object({
  provider: z.enum(['groq', 'gemini']),
});

router.post('/byok/validate', byokValidateLimiter, async (req, res) => {
  const parsed = ByokValidateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'Request validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const provider = parsed.data.provider;
  const keyHeader = provider === 'groq' ? req.header('x-groq-api-key') : req.header('x-gemini-api-key');
  const key = keyHeader?.trim();

  if (!key) {
    res.status(200).json({ valid: false });
    return;
  }

  const endpoint = provider === 'groq'
    ? 'https://api.groq.com/openai/v1/models'
    : 'https://generativelanguage.googleapis.com/v1beta/openai/models';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 200) {
      res.status(200).json({ valid: true });
    } else {
      res.status(200).json({ valid: false });
    }
  } catch (_error) {
    clearTimeout(timeoutId);
    res.status(200).json({ valid: false, reason: 'unreachable' });
  }
});

router.post('/generate', generateIpLimiter, visitorDailyLimiter, async (req, res) => {
  // 1. Parse body
  const parsed = GenerateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'Request validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  // 2. Batch counts per unique URL requested (a batch of 5 unique pages consumes 5 runs of daily quota)
  const dedupeCount = 'urls' in parsed.data ? new Set(parsed.data.urls).size : 1;
  const requested = dedupeCount;

  // 3. BYOK check: extract keys from request headers
  const requestKeys: RequestLlmKeys = {
    groq: req.header('x-groq-api-key')?.trim() || undefined,
    gemini: req.header('x-gemini-api-key')?.trim() || undefined,
  };
  const usesOwnKeys = hasOwnKeys(req);

  // Enforce ALTCHA proof-of-work if not using own keys
  if (!usesOwnKeys) {
    const payload = parsed.data.altcha;
    if (!payload || !(await powService.verifyAndConsume(payload))) {
      res.status(400).json({
        error: 'POW_FAILED',
        message: 'Bot verification failed. Please retry.',
      });
      return;
    }
  }

  // 4. Daily quota check (skipped for BYOK)
  if (!usesOwnKeys) {
    const used = await jobsCreatedToday();
    if (used + requested > config.GENERATE_DAILY_LIMIT) {
      res.status(429).json({
        error: 'DAILY_QUOTA_EXHAUSTED',
        message: 'The free daily demo quota is exhausted.',
        details: {
          limit: config.GENERATE_DAILY_LIMIT,
          used,
          resetsAt: nextUtcMidnight().toISOString(),
        },
      });
      return;
    }
  }

  // 5. Concurrency gate wrapped in withRequestLlmKeys
  const pipelineOptions = { visitorId: req.visitorId, usedOwnKeys: usesOwnKeys };

  try {
    await withRequestLlmKeys(requestKeys, async () => {
      if ('urls' in parsed.data) {
        res.json(
          await runBatch(parsed.data.urls, async (url) => {
            if (!pipelineGate.tryAcquire()) {
              throw new QueueFullError();
            }
            try {
              return await runPipeline(url, pipelineOptions);
            } finally {
              pipelineGate.release();
            }
          })
        );
        return;
      }

      if (!pipelineGate.tryAcquire()) {
        res.status(429).json({
          error: 'QUEUE_FULL',
          message: 'The execution queue is currently full. Please retry shortly.',
        });
        return;
      }

      try {
        const result = await runPipeline(parsed.data.url, pipelineOptions);
        res.json(result);
      } finally {
        pipelineGate.release();
      }
    });
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