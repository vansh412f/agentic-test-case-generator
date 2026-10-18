import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { getJobById, listJobs } from '../db/jobs.ts';
import { buildJobDetail } from '../agent/jobDetail.ts';
import { generateHtmlReport } from '../report/htmlReport.ts';
import { exportProject } from '../export/projectExporter.ts';
import { JobError } from './jobErrors.ts';
import { toHttpError } from './errors.ts';
import { handleJobStream } from './jobStream.ts';

const router = Router();
const JobIdSchema = z.object({ id: z.string().uuid() });
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
    res.json(buildJobDetail(job, { viewerVisitorId: req.visitorId }));
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
