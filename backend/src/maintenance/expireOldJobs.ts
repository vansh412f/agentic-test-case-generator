/**
 * Maintenance script to clean up expired jobs older than RETENTION_DAYS (default: 180 days).
 *
 * Scheduling note:
 * Running this script on a schedule (e.g. Render cron or GitHub Actions) is deferred
 * to Phase 9. This script provides the CLI utility for manual runs and dry runs.
 *
 * Usage:
 *   pnpm run jobs:expire           # Dry-run: prints count of eligible jobs
 *   pnpm run jobs:expire --apply   # Actually deletes matching jobs and cascades
 */
import { prisma } from '../db/client.ts';

async function main() {
  const isApply = process.argv.includes('--apply');
  const retentionDays = Number.parseInt(process.env.RETENTION_DAYS || '180', 10);
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const sampleIds = (process.env.SAMPLE_JOB_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const where = {
    createdAt: { lt: cutoffDate },
    ...(sampleIds.length > 0 ? { id: { notIn: sampleIds } } : {}),
  };

  const eligibleCount = await prisma.job.count({ where });

  console.log(`[Retention] Cutoff date (${retentionDays} days): ${cutoffDate.toISOString()}`);
  console.log(`[Retention] Found ${eligibleCount} job(s) eligible for expiration.`);

  if (!isApply) {
    console.log('[Retention] Dry run completed. Pass --apply to delete.');
    return;
  }

  if (eligibleCount === 0) {
    console.log('[Retention] Nothing to delete.');
    return;
  }

  const result = await prisma.job.deleteMany({ where });
  console.log(`[Retention] Successfully deleted ${result.count} job(s).`);
}

main()
  .catch((err) => {
    console.error('[Retention] Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
