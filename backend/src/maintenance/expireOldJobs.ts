import { prisma } from '../db/client.ts';
import { config } from '../config.ts';
import { recordServerEvent } from '../observability/serverEvents.ts';

export async function runRetention(): Promise<{ deletedJobs: number; truncatedAttempts: number }> {
  if (config.LOCAL_AGENT_MODE) {
    return { deletedJobs: 0, truncatedAttempts: 0 };
  }

  const retentionDays = Number.parseInt(process.env.RETENTION_DAYS || '30', 10);
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const sampleIds = (process.env.SAMPLE_JOB_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const where = {
    createdAt: { lt: cutoffDate },
    ...(sampleIds.length > 0 ? { id: { notIn: sampleIds } } : {}),
  };

  let deletedJobs = 0;
  try {
    const deleteResult = await prisma.job.deleteMany({ where });
    deletedJobs = deleteResult.count;
    if (deletedJobs > 0) {
      console.log(`[Retention] Deleted ${deletedJobs} job(s) older than ${retentionDays} days.`);
    }
  } catch (err) {
    console.warn(`[Retention] Failed to delete expired jobs: ${err instanceof Error ? err.message : String(err)}`);
    recordServerEvent('warn', 'retention:jobs', err);
  }

  let truncatedAttempts = 0;
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    truncatedAttempts = await prisma.$executeRawUnsafe(`
      UPDATE "ExecutionResult" er
      SET code = ''
      FROM "GeneratedTest" gt
      WHERE er."generatedTestId" = gt.id
        AND er."createdAt" < $1
        AND er."attemptNumber" > 1
        AND er."attemptNumber" < gt."totalAttempts"
        AND er.code != ''
    `, sevenDaysAgo);
    if (truncatedAttempts > 0) {
      console.log(`[Retention] Truncated code for ${truncatedAttempts} intermediate attempt(s) older than 7 days.`);
    }
  } catch (err) {
    console.warn(`[Retention] Failed to truncate intermediate attempt code: ${err instanceof Error ? err.message : String(err)}`);
    recordServerEvent('warn', 'retention:intermediate_code', err);
  }

  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const deleteEvents = await prisma.serverEvent.deleteMany({
      where: { createdAt: { lt: fourteenDaysAgo } },
    });
    if (deleteEvents.count > 0) {
      console.log(`[Retention] Deleted ${deleteEvents.count} server event(s) older than 14 days.`);
    }
  } catch (err) {
    console.warn(`[Retention] Failed to delete expired server events: ${err instanceof Error ? err.message : String(err)}`);
    recordServerEvent('warn', 'retention:server_events', err);
  }

  return { deletedJobs, truncatedAttempts };
}

// CLI entrypoint
if (process.argv[1]?.endsWith('expireOldJobs.ts') || process.argv[1]?.endsWith('expireOldJobs.js')) {
  runRetention()
    .then(({ deletedJobs, truncatedAttempts }) => {
      console.log(`[Retention] Completed: deleted ${deletedJobs} job(s), truncated ${truncatedAttempts} attempt(s).`);
    })
    .catch((err) => {
      console.error('[Retention] Failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
