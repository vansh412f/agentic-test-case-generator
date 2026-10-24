import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { getJobById, getJobDetailView, listJobs } from '../db/jobs.ts';
import { buildJobDetail } from '../agent/jobDetail.ts';
import { generateHtmlReport } from '../report/htmlReport.ts';
import { exportProject } from '../export/projectExporter.ts';
import { JobError } from './jobErrors.ts';
import { toHttpError } from './errors.ts';
import { handleJobStream, isTerminal } from './jobStream.ts';
import { runQueue } from '../agent/runQueue.ts';
import { cancelJob } from '../agent/cancellation.ts';
import { publishJobEvent } from '../agent/jobEvents.ts';
import { prisma } from '../db/client.ts';
import { config } from '../config.ts';
import { signTraceToken, traceForAttempt } from '../runner/traceStore.ts';
import type { JobStatus } from '@prisma/client';

const router = Router();
const JobIdSchema = z.object({ id: z.string().uuid() });
const CancelBodySchema = z.object({ scope: z.enum(['job', 'group']) });
const TestCaseParamsSchema = z.object({
  id: z.string().uuid(),
  testCaseId: z.string().regex(/^[\w-]{1,40}$/),
});
const PaginationSchema = z.object({
  page: z.string().regex(/^[1-9]\d*$/).default('1').transform(Number)
    .pipe(z.number().int().min(1).max(1_000_000)),
  limit: z.string().regex(/^[1-9]\d*$/).default('20').transform(Number)
    .pipe(z.number().int().min(1).max(100)),
});

function invalid(res: Response, details: unknown): void {
  res.status(400).json({ error: 'INVALID_REQUEST', message: 'Request validation failed', details });
}

function respondWithError(res: Response, error: unknown): void {
  if (res.headersSent || res.destroyed) {
    console.error('[Job response stream]', error instanceof Error ? error.message : String(error));
    res.destroy(error instanceof Error ? error : new Error('Response stream failed'));
    return;
  }
  const mapped = toHttpError(error);
  if (!mapped) throw error;
  res.removeHeader('Content-Disposition');
  res.removeHeader('Content-Type');
  if (mapped.headers) {
    for (const [key, value] of Object.entries(mapped.headers)) {
      res.setHeader(key, value);
    }
  }
  res.status(mapped.status).json(mapped.body);
}

router.get('/', async (req, res) => {
  const parsed = PaginationSchema.safeParse(req.query);
  if (!parsed.success) {
    invalid(res, parsed.error.flatten().fieldErrors);
    return;
  }
  try {
    res.json(await listJobs(parsed.data.page, parsed.data.limit, req.visitorId));
  } catch (error) {
    respondWithError(res, error);
  }
});

router.get('/:id', async (req, res) => {
  const parsed = JobIdSchema.safeParse(req.params);
  if (!parsed.success) {
    invalid(res, parsed.error.flatten().fieldErrors);
    return;
  }
  try {
    const job = await getJobDetailView(parsed.data.id);
    if (!job) throw new JobError('JOB_NOT_FOUND', 'Job not found.');
    let groupRemainingJobs: number | undefined;
    if (job.runGroupId) {
      groupRemainingJobs = await prisma.job.count({
        where: {
          runGroupId: job.runGroupId,
          id: { not: job.id },
          status: { notIn: ['completed', 'failed', 'cancelled'] },
        },
      });
    }
    const detail = buildJobDetail(job as any, { viewerVisitorId: req.visitorId, groupRemainingJobs });
    const queuePosition = runQueue.positionOf(job.id) ?? null;
    res.json({ ...detail, queuePosition });
  } catch (error) {
    respondWithError(res, error);
  }
});

router.get('/:id/appmap', async (req, res) => {
  const parsed = JobIdSchema.safeParse(req.params);
  if (!parsed.success) {
    invalid(res, parsed.error.flatten().fieldErrors);
    return;
  }
  try {
    const job = await prisma.job.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, visitorId: true, appMap: true },
    });
    if (!job) throw new JobError('JOB_NOT_FOUND', 'Job not found.');
    res.json({ appMap: job.appMap });
  } catch (error) {
    respondWithError(res, error);
  }
});

router.post('/:id/cancel', async (req, res) => {
  const parsedParams = JobIdSchema.safeParse(req.params);
  if (!parsedParams.success) {
    invalid(res, parsedParams.error.flatten().fieldErrors);
    return;
  }
  const parsedBody = CancelBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    invalid(res, parsedBody.error.flatten().fieldErrors);
    return;
  }

  try {
    const job = await prisma.job.findUnique({
      where: { id: parsedParams.data.id },
      select: { id: true, visitorId: true, status: true, runGroupId: true },
    });
    if (!job || !req.visitorId || job.visitorId !== req.visitorId) {
      throw new JobError('JOB_NOT_FOUND', 'Job not found.');
    }

    if (isTerminal(job.status)) {
      throw new JobError('NOT_CANCELLABLE', 'Job is already finished.');
    }

    let targetJobs: Array<{ id: string; status: JobStatus }> = [];
    if (parsedBody.data.scope === 'group' && job.runGroupId) {
      targetJobs = await prisma.job.findMany({
        where: {
          runGroupId: job.runGroupId,
          status: { notIn: ['completed', 'failed', 'cancelled'] },
        },
        select: { id: true, status: true },
      });
    } else {
      targetJobs = [{ id: job.id, status: job.status }];
    }

    const cancelledIds: string[] = [];
    const now = new Date();

    for (const target of targetJobs) {
      const wasQueued = runQueue.removeQueuedJob(target.id);
      if (!wasQueued) {
        cancelJob(target.id);
      }
      const updateRes = await prisma.job.updateMany({
        where: {
          id: target.id,
          status: { notIn: ['completed', 'failed', 'cancelled'] },
        },
        data: {
          status: 'cancelled',
          cancelledAt: now,
        },
      });
      if (updateRes.count === 1) {
        cancelledIds.push(target.id);
        publishJobEvent(target.id, {
          type: 'job_finished',
          data: { status: 'cancelled', errorCode: null },
        });
        publishJobEvent(target.id, {
          type: 'phase_change',
          data: { status: 'cancelled' },
        });
      }
    }

    if (cancelledIds.length === 0) {
      throw new JobError('NOT_CANCELLABLE', 'Job is already finished.');
    }

    res.status(202).json({ cancelled: cancelledIds });
  } catch (error) {
    respondWithError(res, error);
  }
});

router.get('/:id/tests/:testCaseId/trace', async (req, res) => {
  const parsedParams = TestCaseParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    invalid(res, parsedParams.error.flatten().fieldErrors);
    return;
  }
  const attemptSchema = z.object({ attempt: z.coerce.number().int().positive() });
  const parsedAttempt = attemptSchema.safeParse(req.query);
  if (!parsedAttempt.success) {
    invalid(res, parsedAttempt.error.flatten().fieldErrors);
    return;
  }

  try {
    const job = await prisma.job.findUnique({
      where: { id: parsedParams.data.id },
      select: { id: true, visitorId: true, status: true },
    });
    if (!job) throw new JobError('JOB_NOT_FOUND', 'Job not found.');

    // Check ownership FIRST before checking trace
    const ownedByViewer = job.visitorId === req.visitorId;
    const localUnclaimed = job.visitorId === null && config.LOCAL_AGENT_MODE;
    if (!ownedByViewer && !localUnclaimed) throw new JobError('JOB_NOT_FOUND', 'Job not found.');

    const attemptNum = parsedAttempt.data.attempt;
    const effectiveOwner = job.visitorId ?? '';
    const entry = traceForAttempt(job.id, parsedParams.data.testCaseId, attemptNum, effectiveOwner);
    if (!entry) throw new JobError('TRACE_NOT_FOUND', 'No trace is available for this test. Traces are kept for one hour after execution.');

    const token = signTraceToken(entry.traceId, effectiveOwner);
    res.json({
      traceId: entry.traceId,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      downloadPath: `/api/traces/${entry.traceId}?t=${token}`,
      viewerPath: `/trace-viewer/index.html?trace=${encodeURIComponent(`/api/traces/${entry.traceId}?t=${token}`)}`,
    });
  } catch (error) {
    respondWithError(res, error);
  }
});

router.get('/:id/stream', handleJobStream);

router.get('/:id/report.html', async (req, res) => {
  const parsed = JobIdSchema.safeParse(req.params);
  if (!parsed.success) {
    invalid(res, parsed.error.flatten().fieldErrors);
    return;
  }
  try {
    const job = await getJobById(parsed.data.id);
    if (!job) throw new JobError('JOB_NOT_FOUND', 'Job not found.');
    if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') {
      throw new JobError('REPORT_NOT_READY', 'The job has not finished.');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('html').send(generateHtmlReport(job));
  } catch (error) {
    respondWithError(res, error);
  }
});

router.get('/:id/export.zip', async (req, res) => {
  const parsed = JobIdSchema.safeParse(req.params);
  if (!parsed.success) {
    invalid(res, parsed.error.flatten().fieldErrors);
    return;
  }
  try {
    const job = await getJobById(parsed.data.id);
    if (!job) throw new JobError('JOB_NOT_FOUND', 'Job not found.');
    if (job.generatedTests.length === 0) throw new JobError('EXPORT_NOT_READY', 'No generated tests are available.');
    const exportable = job.generatedTests.filter((test) => test.finalStatus === 'passed' || test.finalStatus === 'failed');
    if (exportable.length === 0) throw new JobError('NO_EXPORTABLE_TESTS', 'No exportable tests are available for this job.');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="tests-${job.id}.zip"`);
    await exportProject(job, res);
  } catch (error) {
    respondWithError(res, error);
  }
});

export default router;
