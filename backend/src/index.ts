import express, { Request, Response, NextFunction } from 'express';
import { config, activeProviders } from './config.ts';
import apiRouter from './api/routes.ts';
import { prisma } from './db/client.ts';

const app = express();

// Trust proxy hop count must match the deployed proxy chain (Render alone = 1;
// Vercel-rewrite -> Render = 2). A wrong value either collapses all users into
// one IP bucket or trusts spoofable headers.
app.set('trust proxy', config.TRUST_PROXY_HOPS);

// Middleware: Parse incoming JSON request bodies
app.use(express.json());

// Middleware: Parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true }));

// Gated CORS and Private-Network-Access middleware for Local Agent mode
if (config.LOCAL_AGENT_MODE) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.header('origin');
    const isAllowedOrigin =
      origin &&
      (/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin) ||
        (config.FRONTEND_ORIGIN && origin === config.FRONTEND_ORIGIN) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

    if (isAllowedOrigin && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Visitor-Id, X-Groq-Api-Key, X-Gemini-Api-Key',
      );
      res.setHeader('Access-Control-Expose-Headers', 'X-Visitor-Id');
    }

    if (req.method === 'OPTIONS') {
      if (isAllowedOrigin) {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.sendStatus(204);
        return;
      }
    }

    next();
  });
}

// Health Check Endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.NODE_ENV,
    llmConfigured: activeProviders.length > 0,
  });
});

// API Routes
app.use('/api', apiRouter);

// 404 Fallback Handler for unknown routes
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.originalUrl} does not exist.`,
  });
});

// Centralized Error Handling Middleware
app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = typeof err?.status === 'number' ? err.status : (typeof err?.statusCode === 'number' ? err.statusCode : 500);

  if (status < 500) {
    console.warn(`[Request error] ${status}: ${err.message}`);
    res.status(status).json({
      error: 'INVALID_REQUEST',
      message: err.message || 'Invalid request body',
    });
    return;
  }

  console.error('[Error]', err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: config.NODE_ENV === 'production' ? 'An internal error occurred.' : err.message,
  });
});

const server = app.listen(config.PORT, () => {
  console.log(`Server running on http://localhost:${config.PORT}`);
  console.log(`Environment: ${config.NODE_ENV}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: draining HTTP requests`);
  const deadline = setTimeout(() => {
    console.error('Graceful shutdown deadline exceeded');
    process.exit(1);
  }, 30_000);
  server.close((error) => {
    void prisma.$disconnect().then(() => {
      clearTimeout(deadline);
      if (error) process.exitCode = 1;
    }).catch((cause: unknown) => {
      console.error('Database disconnect failed:', cause instanceof Error ? cause.message : String(cause));
      process.exit(1);
    });
  });
  server.closeIdleConnections();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

export default app;