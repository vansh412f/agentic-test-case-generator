import crypto from 'node:crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client.ts';
import { config } from '../config.ts';

const adminRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // Never accept the secret in a query string.
  const adminSecretHeader = req.header('x-admin-secret');
  const configuredSecret = config.ADMIN_SECRET;

  if (!configuredSecret || !adminSecretHeader) {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} does not exist.`,
    });
    return;
  }

  const headerBuf = Buffer.from(adminSecretHeader);
  const secretBuf = Buffer.from(configuredSecret);

  if (headerBuf.length !== secretBuf.length || !crypto.timingSafeEqual(headerBuf, secretBuf)) {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} does not exist.`,
    });
    return;
  }

  next();
}

adminRouter.use(requireAdmin);

adminRouter.get('/events', async (req: Request, res: Response) => {
  const { level, since, limit } = req.query;

  const take = Math.min(200, Math.max(1, parseInt(typeof limit === 'string' ? limit : '50', 10) || 50));

  const where: { level?: string; createdAt?: { gte: Date } } = {};
  if (level === 'warn' || level === 'error') {
    where.level = level;
  }

  if (typeof since === 'string') {
    const sinceDate = new Date(since);
    if (!isNaN(sinceDate.getTime())) {
      where.createdAt = { gte: sinceDate };
    }
  }

  try {
    const events = await prisma.serverEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve server events.' });
  }
});

export default adminRouter;
