import type { Request, Response } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { hasOwnKeys } from '../llm/requestKeys.ts';

function computeRetryAfterSeconds(res: Response, windowMs: number): number {
  const header = res.getHeader('Retry-After');
  if (typeof header === 'number') return header;
  if (typeof header === 'string') {
    const parsed = Number.parseInt(header, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Math.ceil(windowMs / 1000);
}

function createRateLimitHandler(windowMs: number) {
  return (_req: Request, res: Response): void => {
    const retryAfterSeconds = computeRetryAfterSeconds(res, windowMs);
    res.status(429).json({
      error: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
      details: { retryAfterSeconds },
    });
  };
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const generateIpLimiter = rateLimit({
  windowMs: ONE_HOUR_MS,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: createRateLimitHandler(ONE_HOUR_MS),
  skip: (req) => hasOwnKeys(req),
});

export const generateByokIpLimiter = rateLimit({
  windowMs: ONE_HOUR_MS,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: createRateLimitHandler(ONE_HOUR_MS),
  skip: (req) => !hasOwnKeys(req),
});

export const crawlIpLimiter = rateLimit({
  windowMs: ONE_HOUR_MS,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: createRateLimitHandler(ONE_HOUR_MS),
});

export const powChallengeLimiter = rateLimit({
  windowMs: ONE_HOUR_MS,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: createRateLimitHandler(ONE_HOUR_MS),
});

export const byokValidateLimiter = rateLimit({
  windowMs: ONE_HOUR_MS,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: createRateLimitHandler(ONE_HOUR_MS),
});

export const visitorDailyLimiter = rateLimit({
  windowMs: ONE_DAY_MS,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.visitorId,
  handler: createRateLimitHandler(ONE_DAY_MS),
  skip: (req) => hasOwnKeys(req),
});
