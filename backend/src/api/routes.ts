import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import jobsRouter from './jobsRoutes.ts';
import { CrawlRequestSchema, GenerateRequestSchema } from './schemas.ts';
import { crawlPage } from '../crawler/pageCrawler.ts';
import { startDetachedRun, type QueuedJob } from '../agent/jobRunner.ts';
import { toHttpError } from './errors.ts';
import { visitorMiddleware } from './visitorMiddleware.ts';
import { webhookUrlProblem, createWebhookTarget } from '../notify/webhook.ts';
import {
  generateIpLimiter,
  generateByokIpLimiter,
  crawlIpLimiter,
  powChallengeLimiter,
  visitorDailyLimiter,
  byokValidateLimiter,
} from './rateLimits.ts';
import { checkProviderKey } from '../llm/keyCheck.ts';
import { powService } from '../security/pow.ts';
import {
  jobsCreatedToday,
  nextUtcMidnight,
  tryReserve,
  releaseReservation,
  getReservedCount,
} from '../security/dailyQuota.ts';
import { pipelineGate, crawlGate } from '../security/concurrencyGate.ts';
import { rememberCrawl } from '../crawler/crawlCache.ts';
import { hasOwnKeys, type RequestLlmKeys } from '../llm/requestKeys.ts';
import { z } from 'zod';
import { config } from '../config.ts';
import { createPendingJobs, getLifetimeStats } from '../db/jobs.ts';

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
    res.json(challenge);
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

  if (!crawlGate.tryAcquire()) {
    res.status(429).json({ error: 'QUEUE_FULL', message: 'Too many previews are running right now. Please retry in a few seconds.' });
    return;
  }

  try {
    const appMap = await crawlPage(parsed.data.url);
    rememberCrawl(parsed.data.url, appMap);
    res.json(appMap);
  } catch (err) {
    const httpErr = toHttpError(err);
    if (httpErr) {
      res.status(httpErr.status).json(httpErr.body);
      return;
    }
    throw err;
  } finally {
    crawlGate.release();
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

  const status = await checkProviderKey(provider, key);
  res.status(200).json({ valid: status === 'valid' });
});

router.post('/generate', generateIpLimiter, generateByokIpLimiter, visitorDailyLimiter, async (req, res) => {
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

  // 2. A run group of N unique URLs consumes N runs of daily quota
  const urls = 'urls' in parsed.data ? [...new Set(parsed.data.urls)] : [parsed.data.url];
  const deepCrawl = 'url' in parsed.data && parsed.data.deepCrawl === true;
  const requested = urls.length;

  const webhookProblem = parsed.data.webhookUrl ? webhookUrlProblem(parsed.data.webhookUrl) : null;
  if (webhookProblem) {
    res.status(400).json({ error: 'INVALID_WEBHOOK_URL', message: webhookProblem });
    return;
  }
  const webhook = parsed.data.webhookUrl ? createWebhookTarget(parsed.data.webhookUrl) : undefined;

  // 3. BYOK check: extract keys from request headers (never logged)
  const requestKeys: RequestLlmKeys = {
    groq: req.header('x-groq-api-key')?.trim() || undefined,
    gemini: req.header('x-gemini-api-key')?.trim() || undefined,
  };
  const usesOwnKeys = hasOwnKeys(req);

  // 4. Key pre-flight check before quota/PoW/gate
  if (usesOwnKeys) {
    for (const provider of ['groq', 'gemini'] as const) {
      const key = requestKeys[provider];
      if (key) {
        const check = await checkProviderKey(provider, key);
        if (check === 'invalid') {
          const providerDisplayName = provider === 'groq' ? 'Groq' : 'Gemini';
          res.status(400).json({
            error: 'INVALID_API_KEY',
            message: `Your ${providerDisplayName} API key was rejected by the provider.`,
            details: { provider },
          });
          return;
        }
      }
    }
  }

  // 5. Daily quota check & reservation BEFORE consuming ALTCHA (skipped for BYOK)
  if (!usesOwnKeys) {
    const admitted = await tryReserve(requested);
    if (!admitted) {
      const dbCount = await jobsCreatedToday();
      const used = dbCount + getReservedCount();
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

  // 5. Enforce ALTCHA proof-of-work if not using own keys
  if (!usesOwnKeys) {
    const payload = parsed.data.altcha;
    if (!payload || !(await powService.verifyAndConsume(payload))) {
      releaseReservation(requested);
      res.status(400).json({
        error: 'POW_FAILED',
        message: 'Bot verification failed. Please retry.',
      });
      return;
    }
  }

  // 6. Concurrency gate: ONE slot per run group. Ownership transfers to startDetachedRun.
  if (!pipelineGate.tryAcquire()) {
    if (!usesOwnKeys) releaseReservation(requested);
    res.status(429).json({
      error: 'QUEUE_FULL',
      message: 'The execution queue is currently full. Please retry shortly.',
    });
    return;
  }

  // 7. Create job rows synchronously (fail-fast) so every returned jobId exists.
  const jobs: QueuedJob[] = urls.map((url, idx) => ({
    id: randomUUID(),
    url,
    deepCrawl,
    ...(idx === 0
      ? {
          testData: parsed.data.testData,
          focus: parsed.data.focus,
        }
      : {}),
  }));
  try {
    await createPendingJobs(
      jobs.map((job) => ({ id: job.id, targetUrl: job.url })),
      { visitorId: req.visitorId, usedOwnKeys: usesOwnKeys },
    );
  } catch (err) {
    pipelineGate.release();
    const httpErr = toHttpError(err);
    if (httpErr) {
      res.status(httpErr.status).json(httpErr.body);
      return;
    }
    throw err;
  } finally {
    // Committed rows are now counted by jobsCreatedToday(); holding the
    // reservation any longer would double-count them for the whole run.
    if (!usesOwnKeys) releaseReservation(requested);
  }

  // 8. Detach. BYOK ALS context is entered inside startDetachedRun.
  startDetachedRun(jobs, requestKeys, { webhook });
  res.status(202).json({
    jobIds: jobs.map((job) => job.id),
    ...(webhook ? { webhookSecret: webhook.secret } : {}),
  });
});

export default router;