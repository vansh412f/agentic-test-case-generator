import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { getJobById, listJobs } from '../db/jobs.ts';
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
import type { JobStatus } from '@prisma/client';

const router = Router();
const JobIdSchema = z.object({ id: z.string().uuid() });
const CancelBodySchema = z.object({ scope: z.enum(['job', 'group']) });
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
    const job = await getJobById(parsed.data.id);
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
    res.json(buildJobDetail(job, { viewerVisitorId: req.visitorId, groupRemainingJobs }));
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
    const job = await getJobById(parsedParams.data.id);
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
      cancelledIds.push(target.id);
      const wasQueued = runQueue.removeQueuedJob(target.id);
      if (wasQueued) {
        await prisma.job.update({
          where: { id: target.id },
          data: { status: 'cancelled', cancelledAt: now },
        });
        publishJobEvent(target.id, {
          type: 'job_finished',
          data: { status: 'cancelled', errorCode: null },
        });
        publishJobEvent(target.id, {
          type: 'phase_change',
          data: { status: 'cancelled' },
        });
      } else {
        const wasRunning = cancelJob(target.id);
        if (!wasRunning) {
          await prisma.job.update({
            where: { id: target.id },
            data: { status: 'cancelled', cancelledAt: now },
          });
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
    }

    res.status(202).json({ cancelled: cancelledIds });
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
