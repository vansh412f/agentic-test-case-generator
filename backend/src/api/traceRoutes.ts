import { Router } from 'express';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { getTrace, verifyTraceToken } from '../runner/traceStore.ts';
import { jobError } from './jobErrors.ts';

const router = Router();
const TraceIdSchema = z.object({ traceId: z.string().uuid() });

router.get('/:traceId', (req, res, next) => {
  const parsed = TraceIdSchema.safeParse(req.params);
  const token = typeof req.query.t === 'string' ? req.query.t : undefined;
  if (!parsed.success || !token) return next(jobError('TRACE_NOT_FOUND'));

  const { traceId } = parsed.data;
  if (!verifyTraceToken(traceId, token)) return next(jobError('TRACE_NOT_FOUND'));

  const found = getTrace(traceId);
  if (!found) return next(jobError('TRACE_NOT_FOUND'));

  const safeTestId = found.entry.testCaseId.replace(/[^\w-]/g, '');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="trace-${safeTestId}-attempt-${found.entry.attemptNumber}.zip"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Length', found.entry.sizeBytes);

  const stream = createReadStream(found.filePath);
  stream.on('error', (err) => {
    if (!res.headersSent) next(err);
    else res.destroy();
  });
  stream.pipe(res);
});

export default router;