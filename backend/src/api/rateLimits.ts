import type { Request, Response } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config.ts';
import { checkProviderKey } from '../llm/keyCheck.ts';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function rateLimitHandler(req: Request, res: Response): void {
  const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
  const resetsAt = resetTime ? resetTime.toISOString() : new Date(Date.now() + ONE_DAY_MS).toISOString();
  res.status(429).json({
    error: 'RATE_LIMITED',
    message: 'Daily limit reached.',
    details: { resetsAt },
  });
}

export const crawlIpLimiter = rateLimit({
  windowMs: ONE_DAY_MS,
  limit: config.CRAWL_DAILY_LIMIT_PER_IP,
  skipFailedRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: rateLimitHandler,
  skip: async (req) => {
    const groqKey = req.header('x-groq-api-key')?.trim();
    if (groqKey) {
      const status = await checkProviderKey('groq', groqKey);
      if (status === 'valid') return true;
    }
    const geminiKey = req.header('x-gemini-api-key')?.trim();
    if (geminiKey) {
      const status = await checkProviderKey('gemini', geminiKey);
      if (status === 'valid') return true;
    }
    return false;
  },
});

export const powChallengeLimiter = rateLimit({
  windowMs: ONE_DAY_MS,
  limit: config.POW_DAILY_LIMIT_PER_IP,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: rateLimitHandler,
});

export const byokValidateLimiter = rateLimit({
  windowMs: ONE_DAY_MS,
  limit: config.BYOK_VALIDATE_DAILY_LIMIT_PER_IP,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  handler: rateLimitHandler,
});
