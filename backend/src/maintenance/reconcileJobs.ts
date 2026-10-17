import { failNonTerminalJobs } from '../db/jobs.ts';

// Single-instance invariant: at boot, this process runs nothing, so every
// non-terminal job created before boot is orphaned regardless of its age.
export async function reconcileOrphanedJobs(bootedAt: Date): Promise<void> {
  try {
    const { count } = await failNonTerminalJobs(
      { createdBefore: bootedAt },
      'SERVER_RESTART',
      'The server restarted while this job was running.',
    );
    if (count > 0) console.warn(`[Reconcile] Marked ${count} orphaned job(s) as failed (SERVER_RESTART)`);
  } catch (error) {
    console.warn('[Reconcile] Skipped:', error instanceof Error ? error.message : String(error));
  }
}
