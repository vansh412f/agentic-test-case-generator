// One POST /api/generate creates a "run group" of 1..MAX_URLS_PER_RUN jobs.
// A run group holds exactly one pipelineGate slot and runs its jobs
// sequentially, so a 5-page run never needs more than one Chromium at a time.
export const MAX_URLS_PER_RUN = 5;
