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
import { recordServerEvent } from './observability/serverEvents.ts';
import { logger } from './observability/logger.ts';
import { toHttpError } from './api/errors.ts';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { RUNNER_DIR } from './runner/config.ts';
import { initTraceStore } from './runner/traceStore.ts';
import { selfCheck } from './runner/isolation.ts';
import { isRemoteBrowserActive, getRedactedBrowserEndpoint } from './browser/remoteBrowser.ts';

const bootedAt = new Date();

const isDirectRun = Boolean(
  process.argv[1] &&
    (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
      process.argv[1].endsWith('index.ts') ||
      process.argv[1].endsWith('index.js')),
);

if (isDirectRun && config.RUNNER_ISOLATION === 'uid') {
  await selfCheck();
}

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

// Security headers (nosniff, strict-origin-when-cross-origin, DENY frame options, SAMEORIGIN for trace-viewer)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/trace-viewer')) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  } else {
    res.setHeader('X-Frame-Options', 'DENY');
  }
  next();
});

export interface IsAllowedOriginOptions {
  nodeEnv: string;
  localMode: boolean;
  frontendOrigins: string[] | string;
  previewRegex?: string | RegExp | null;
}

export function isAllowedOrigin(origin: string, options: IsAllowedOriginOptions): boolean {
  if (!origin) return false;

  const allowedOrigins = Array.isArray(options.frontendOrigins)
    ? options.frontendOrigins
    : (options.frontendOrigins || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  if (options.previewRegex) {
    const regex =
      typeof options.previewRegex === 'string'
        ? new RegExp(options.previewRegex)
        : options.previewRegex;
    if (regex.test(origin)) {
      return true;
    }
  }

  if (options.localMode || options.nodeEnv !== 'production') {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return true;
    }
  }

  return false;
}

// CORS middleware driven by FRONTEND_ORIGIN allowlist (comma-separated), preview regex, and localhost.
// Needed in production for direct SSE stream fallback and in local agent mode for PNA.
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.header('origin');
  if (!origin) {
    next();
    return;
  }

  const allowed = isAllowedOrigin(origin, {
    nodeEnv: config.NODE_ENV,
    localMode: config.LOCAL_AGENT_MODE,
    frontendOrigins: config.FRONTEND_ORIGIN || '',
    previewRegex: config.CORS_PREVIEW_ORIGIN_REGEX,
  });

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Visitor-Id, X-Groq-Api-Key, X-Gemini-Api-Key',
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-Visitor-Id');
  }

  if (req.method === 'OPTIONS') {
    if (allowed) {
      if (config.LOCAL_AGENT_MODE) {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      res.sendStatus(204);
      return;
    }
  }

  next();
});


// Trace viewer static mount (Playwright 1.63 bundled viewer; public shell,
// trace data itself only loads via signed URLs).
let traceViewerDir: string | null = null;
try {
  const runnerRequire = createRequire(path.join(RUNNER_DIR, 'package.json'));
  const testPkgPath = runnerRequire.resolve('@playwright/test/package.json');
  const corePkgPath = createRequire(testPkgPath).resolve('playwright-core/package.json');
  const candidate = path.join(path.dirname(corePkgPath), 'lib', 'vite', 'traceViewer');
  if (fs.existsSync(path.join(candidate, 'index.html'))) {
    traceViewerDir = candidate;
  }
} catch {
  // Viewer is optional; signed download still works without it.
}
if (traceViewerDir) {
  app.use('/trace-viewer', express.static(traceViewerDir, { index: 'index.html', maxAge: '1h', immutable: false }));
  logger.info(`serving /trace-viewer from ${traceViewerDir}`, { component: 'TraceViewer' });
} else {
  logger.warn('bundled viewer not found; /trace-viewer disabled', { component: 'TraceViewer' });
}

// Initialize trace store (boot clean slate, start sweep interval)
void initTraceStore().catch((err) => {
  logger.warn('init failed', { component: 'TraceStore', error: err instanceof Error ? err.message : String(err) });
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

  const status = typeof err?.status === 'number' ? err.status : (typeof err?.statusCode === 'number' ? err.statusCode : 500);

  if (status < 500) {
    logger.warn(`Request error: ${err.message}`, { component: 'Server', status });
    res.status(status).json({
      error: 'INVALID_REQUEST',
      message: err.message || 'Invalid request body',
    });
    return;
  }

  logger.error('Unhandled route error', { component: 'Server', error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: config.NODE_ENV === 'production' ? 'An internal error occurred.' : err.message,
  });
});

let server: ReturnType<typeof app.listen> | undefined;

if (isDirectRun) {
  server = app.listen(config.PORT, () => {
    logger.info(`Server running on http://localhost:${config.PORT}`, { component: 'Server', port: config.PORT, nodeEnv: config.NODE_ENV });
    if (isRemoteBrowserActive()) {
      logger.info(`Remote browser active: ${getRedactedBrowserEndpoint()}`, {
        component: 'Server',
        remoteBrowser: getRedactedBrowserEndpoint(),
      });
    } else {
      logger.info('Browser execution mode: local Chromium', { component: 'Server' });
    }
    void reconcileOrphanedJobs(bootedAt);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { component: 'Server', reason: reason instanceof Error ? reason.message : String(reason) });
    recordServerEvent('error', 'process:unhandledRejection', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { component: 'Server', error: error instanceof Error ? error.message : String(error) });
    recordServerEvent('error', 'process:uncaughtException', error);
    shutdown('uncaughtException');
  });

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

let shuttingDown = false;
async function failInFlightJobs(): Promise<void> {
  const ids = inFlightJobs();
  if (ids.length === 0) return;
  try {
    await failNonTerminalJobs({ ids }, 'SERVER_SHUTDOWN', 'The server shut down while this job was running.');
  } catch (error) {
    logger.warn('Could not mark in-flight jobs failed', { component: 'Shutdown', error: error instanceof Error ? error.message : String(error) });
  }
  for (const id of ids) {
    publishJobEvent(id, { type: 'job_finished', data: { status: 'failed', errorCode: 'SERVER_SHUTDOWN' } });
  }
}

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received: draining HTTP requests and closing streams`, { component: 'Shutdown', signal });
  const deadline = setTimeout(() => {
    logger.error('Graceful shutdown deadline exceeded', { component: 'Shutdown' });
    process.exit(1);
  }, 30_000);
  deadline.unref();

  void failInFlightJobs().finally(() => {
    // SSE connections never go idle; without this server.close() waits for the deadline.
    closeAllJobStreams();
    if (server) {
      server.close((error) => {
        // Detached pipelines + Chromium children keep the event loop alive, so exit explicitly.
        void prisma.$disconnect()
          .catch((cause: unknown) => {
            logger.error('Database disconnect failed', { component: 'Shutdown', cause: cause instanceof Error ? cause.message : String(cause) });
          })
          .finally(() => process.exit(error ? 1 : 0));
      });
      server.closeIdleConnections();
    } else {
      process.exit(0);
    }
  });
}

export default app;