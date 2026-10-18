import express, { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import { config } from './config.ts';
import apiRouter from './api/routes.ts';
import { prisma } from './db/client.ts';
import { failNonTerminalJobs } from './db/jobs.ts';
import { inFlightJobs } from './agent/jobRunner.ts';
import { publishJobEvent } from './agent/jobEvents.ts';
import { closeAllJobStreams } from './api/jobStream.ts';
import { reconcileOrphanedJobs } from './maintenance/reconcileJobs.ts';

const bootedAt = new Date();

const app = express();

// Trust proxy hop count must match the deployed proxy chain (Render alone = 1;
// Vercel-rewrite -> Render = 2). A wrong value either collapses all users into
// one IP bucket or trusts spoofable headers.
app.set('trust proxy', config.TRUST_PROXY_HOPS);
app.disable('x-powered-by');
app.use(compression());

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
  void reconcileOrphanedJobs(bootedAt);
});

// Detached pipelines (Phase 8) make an unhandled rejection a process-killer.
// Every detached chain has its own .catch; this is defense in depth.
process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled promise rejection:', reason instanceof Error ? reason.message : String(reason));
});

let shuttingDown = false;
async function failInFlightJobs(): Promise<void> {
  const ids = inFlightJobs();
  if (ids.length === 0) return;
  try {
    await failNonTerminalJobs({ ids }, 'SERVER_SHUTDOWN', 'The server shut down while this job was running.');
  } catch (error) {
    console.warn('[Shutdown] Could not mark in-flight jobs failed:', error instanceof Error ? error.message : String(error));
  }
  for (const id of ids) {
    publishJobEvent(id, { type: 'job_finished', data: { status: 'failed', errorCode: 'SERVER_SHUTDOWN' } });
  }
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: failing in-flight jobs, closing streams, draining HTTP requests`);
  const deadline = setTimeout(() => {
    console.error('Graceful shutdown deadline exceeded');
    process.exit(1);
  }, 30_000);
  deadline.unref();

  void failInFlightJobs().finally(() => {
    // SSE connections never go idle; without this server.close() waits for the deadline.
    closeAllJobStreams();
    server.close((error) => {
      // Detached pipelines + Chromium children keep the event loop alive, so exit explicitly.
      void prisma.$disconnect()
        .catch((cause: unknown) => {
          console.error('Database disconnect failed:', cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => process.exit(error ? 1 : 0));
    });
    server.closeIdleConnections();
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

export default app;