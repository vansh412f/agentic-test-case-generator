import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import jobsRouter from './jobsRoutes.ts';
import adminRouter from './adminRoutes.ts';
import traceRouter from './traceRoutes.ts';
import { CrawlRequestSchema, GenerateRequestSchema } from './schemas.ts';
import { crawlPage } from '../crawler/pageCrawler.ts';
import type { QueuedJob } from '../agent/jobRunner.ts';
import { toHttpError } from './errors.ts';
import { assertPublicTarget } from '../security/netPolicy.ts';
import { visitorMiddleware } from './visitorMiddleware.ts';
import { webhookUrlProblem, createWebhookTarget } from '../notify/webhook.ts';
import {
  crawlIpLimiter,
  powChallengeLimiter,
  byokValidateLimiter,
} from './rateLimits.ts';
import { checkProviderKey } from '../llm/keyCheck.ts';
import { powService } from '../security/pow.ts';
import { clientIp } from '../security/clientIp.ts';
import {
  ipHashFor,
  tryReserveRun,
  budgetStatus,
  nextUtcMidnight,
} from '../security/dailyBudget.ts';
import { QueueFullError } from '../security/concurrencyGate.ts';
import { runQueue, type ClaimToken } from '../agent/runQueue.ts';
import { rememberCrawl } from '../crawler/crawlCache.ts';
import { hasOwnKeys, type RequestLlmKeys } from '../llm/requestKeys.ts';
import { z } from 'zod';
import { config } from '../config.ts';
import { createPendingJobs, getLifetimeStats } from '../db/jobs.ts';
import { prisma } from '../db/client.ts';
import { warmRemoteBrowser } from '../browser/remoteBrowser.ts';

const router = Router();
router.use(visitorMiddleware);
router.use('/jobs', jobsRouter);
router.use('/admin', adminRouter);
router.use('/traces', traceRouter);


router.get('/health', (_req, res) => {
  res.json({ ok: true, uptimeSec: Math.floor(process.uptime()), mode: config.LOCAL_AGENT_MODE ? 'local' : 'hosted' });
});

interface DbHealthCache {
  result: { ok: boolean; db: 'ok' | 'error'; checkedAt: string };
  cachedAt: number;
}
let dbHealthCache: DbHealthCache | null = null;
const DB_HEALTH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// UptimeRobot monitor #2 keeps Supabase active
router.get('/health/db', async (_req, res) => {
  const now = Date.now();
  if (dbHealthCache && now - dbHealthCache.cachedAt < DB_HEALTH_CACHE_TTL_MS) {
    res.json(dbHealthCache.result);
    return;
  }
  try {
    await prisma.job.findFirst({ select: { id: true } });
    const result = { ok: true, db: 'ok' as const, checkedAt: new Date().toISOString() };
    dbHealthCache = { result, cachedAt: now };
    res.json(result);
  } catch (err) {
    dbHealthCache = null;
    const result = { ok: false, db: 'error' as const, checkedAt: new Date().toISOString() };
    res.status(503).json(result);
  }
});

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
      if (httpErr.headers) {
        for (const [key, value] of Object.entries(httpErr.headers)) {
          res.setHeader(key, value);
        }
      }
      res.status(httpErr.status).json(httpErr.body);
      return;
    }
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve stats.' });
  }
});

router.get('/pow/challenge', powChallengeLimiter, async (_req, res) => {
  try {
    const challenge = await powService.createChallenge();
    warmRemoteBrowser();
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
    const invalidUrlIssue = parsed.error.issues.find(
      (issue) => 'params' in issue && (issue.params as { code?: string } | undefined)?.code === 'INVALID_URL',
    );
    if (invalidUrlIssue && 'params' in invalidUrlIssue) {
      const params = (invalidUrlIssue.params as Record<string, unknown>) || {};
      const { code: _, ...details } = params;
      res.status(400).json({
        error: 'INVALID_URL',
        message: invalidUrlIssue.message,
        details: { reason: (details.reason as string) || 'invalid_format', ...details },
      });
      return;
    }
    res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'Request validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    await assertPublicTarget(parsed.data.url);
  } catch (err) {
    const httpErr = toHttpError(err);
    if (httpErr) {
      res.status(httpErr.status).json(httpErr.body);
      return;
    }
    throw err;
  }

  warmRemoteBrowser();

  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) ac.abort();
  });

  try {
    const appMap = await crawlPage(parsed.data.url, { signal: ac.signal, gateMode: 'preview' });
    rememberCrawl(parsed.data.url, appMap);
    res.json(appMap);
  } catch (err) {
    if (ac.signal.aborted || res.writableEnded) {
      return;
    }
    if (err instanceof QueueFullError) {
      res.status(429).json({ error: 'QUEUE_FULL', message: 'Previews are busy, retry in a moment.' });
      return;
    }
    const httpErr = toHttpError(err);
    if (httpErr) {
      if (httpErr.headers) {
        for (const [key, value] of Object.entries(httpErr.headers)) {
          res.setHeader(key, value);
        }
      }
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

  const status = await checkProviderKey(provider, key);
  res.status(200).json({ valid: status === 'valid' });
});

router.get('/budget', async (req, res) => {
  if (config.LOCAL_AGENT_MODE) {
    res.json({
      mode: 'local',
      unlimited: true,
      maxUrlsPerRun: config.BYOK_MAX_URLS_PER_RUN,
    });
    return;
  }

  const byok = hasOwnKeys(req);
  if (byok) {
    res.json({
      byok: true,
      maxUrlsPerRun: config.BYOK_MAX_URLS_PER_RUN,
      remaining: null,
      resetsAt: nextUtcMidnight().toISOString(),
      scopes: [],
    });
    return;
  }

  const ipHash = ipHashFor(clientIp(req));
  const status = await budgetStatus({ visitorId: req.visitorId, ipHash });
  res.json({
    byok: false,
    maxUrlsPerRun: config.FREE_MAX_URLS_PER_RUN,
    remaining: status.remaining,
    resetsAt: status.resetsAt,
    scopes: status.scopes,
  });
});

router.post('/generate', async (req, res) => {
  // 1. Parse body
  const parsed = GenerateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const invalidUrlIssue = parsed.error.issues.find(
      (issue) => 'params' in issue && (issue.params as { code?: string } | undefined)?.code === 'INVALID_URL',
    );
    if (invalidUrlIssue && 'params' in invalidUrlIssue) {
      const params = (invalidUrlIssue.params as Record<string, unknown>) || {};
      const { code: _, ...details } = params;
      res.status(400).json({
        error: 'INVALID_URL',
        message: invalidUrlIssue.message,
        details: { reason: (details.reason as string) || 'invalid_format', ...details },
      });
      return;
    }
    res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'Request validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  // 2. A run group of N unique URLs consumes N runs of daily quota
  const urls = 'urls' in parsed.data ? [...new Set(parsed.data.urls)] : [parsed.data.url];
  for (const targetUrl of urls) {
    try {
      await assertPublicTarget(targetUrl);
    } catch (err) {
      const httpErr = toHttpError(err);
      if (httpErr) {
        res.status(httpErr.status).json(httpErr.body);
        return;
      }
      throw err;
    }
  }
  warmRemoteBrowser();
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

  const maxUrls = (usesOwnKeys || config.LOCAL_AGENT_MODE) ? config.BYOK_MAX_URLS_PER_RUN : config.FREE_MAX_URLS_PER_RUN;
  if (requested > maxUrls) {
    res.status(400).json({
      error: 'TOO_MANY_URLS',
      message: `A single run may contain at most ${maxUrls} URLs.`,
      details: { max: maxUrls },
    });
    return;
  }

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

  const ipHash = ipHashFor(clientIp(req));
  const client = { visitorId: req.visitorId, ipHash };

  let claimToken: ClaimToken | null = null;
  if (!config.LOCAL_AGENT_MODE) {
    claimToken = runQueue.claim(client);
    if (!claimToken) {
      const existingGroup = runQueue.activeOrQueuedFor(client);
      res.status(409).json({
        error: 'ALREADY_RUNNING',
        message: 'You already have a run in progress.',
        details: { jobIds: existingGroup ? existingGroup.jobs.map((j) => j.id) : [] },
      });
      return;
    }
  }

  try {
    // 6. Queue capacity check
    if (runQueue.isFull()) {
      res.status(429).json({
        error: 'QUEUE_FULL',
        message: 'The execution queue is currently full. Please retry shortly.',
      });
      return;
    }

    // 7. Daily budget check & reservation BEFORE consuming ALTCHA (skipped for BYOK and LOCAL_AGENT_MODE)
    let reservation: Awaited<ReturnType<typeof tryReserveRun>> | undefined;
    if (!usesOwnKeys && !config.LOCAL_AGENT_MODE) {
      reservation = await tryReserveRun({
        visitorId: req.visitorId,
        ipHash,
        n: requested,
      });
      if (!reservation.ok) {
        if (reservation.reason === 'unavailable') {
          res.setHeader('Retry-After', '30');
          res.status(503).json({
            error: 'SERVICE_UNAVAILABLE',
            message: 'Usage tracking is temporarily unavailable.',
          });
          return;
        }
        res.status(429).json({
          error: 'DAILY_QUOTA_EXHAUSTED',
          message: 'Daily quota exhausted.',
          details: {
            scope: reservation.scope,
            limit: reservation.limit,
            used: reservation.used,
            resetsAt: reservation.resetsAt,
          },
        });
        return;
      }

      // 8. Enforce ALTCHA proof-of-work if not using own keys and not in local mode
      const payload = parsed.data.altcha;
      if (!payload || !(await powService.verifyAndConsume(payload))) {
        reservation.release();
        res.status(400).json({
          error: 'POW_FAILED',
          message: 'Bot verification failed. Please retry.',
        });
        return;
      }
    }

    // 9. Create job rows synchronously (fail-fast) so every returned jobId exists.
    const runGroupId = randomUUID();
    const fresh = parsed.data.fresh;
    const testDataByUrl = 'testDataByUrl' in parsed.data ? parsed.data.testDataByUrl : undefined;
    const defaultTestData = parsed.data.testData;

    const jobs: QueuedJob[] = urls.map((url, idx) => {
      const jobTestData = testDataByUrl?.[url] ?? defaultTestData;
      return {
        id: randomUUID(),
        url,
        fresh,
        testData: jobTestData,
        ...(idx === 0 ? { focus: parsed.data.focus } : {}),
      };
    });

    try {
      await createPendingJobs(
        jobs.map((job) => ({ id: job.id, targetUrl: job.url })),
        {
          visitorId: req.visitorId,
          usedOwnKeys: usesOwnKeys,
          ipHash,
          runGroupId,
          quotaExempt: config.LOCAL_AGENT_MODE,
        },
      );
    } catch (err) {
      const httpErr = toHttpError(err);
      if (httpErr) {
        if (httpErr.headers) {
          for (const [key, value] of Object.entries(httpErr.headers)) {
            res.setHeader(key, value);
          }
        }
        res.status(httpErr.status).json(httpErr.body);
        return;
      }
      throw err;
    } finally {
      if (reservation?.ok) reservation.release();
    }

    // 10. Enqueue run group
    const queuePosition = runQueue.enqueue(
      {
        groupId: runGroupId,
        jobs,
        keys: requestKeys,
        webhook,
        client,
        enqueuedAt: Date.now(),
      },
      claimToken,
    );
    claimToken = null;

    res.status(202).json({
      jobIds: jobs.map((job) => job.id),
      runGroupId,
      queuePosition,
      ...(webhook ? { webhookSecret: webhook.secret } : {}),
    });
  } finally {
    if (claimToken) {
      runQueue.releaseClaim(claimToken);
    }
  }
});

export default router;
// Module component implementation.
