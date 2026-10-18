// One POST /api/generate creates a "run group" of 1..MAX_URLS_PER_RUN jobs.
// A run group holds exactly one pipelineGate slot and runs its jobs
// sequentially, so a 5-page run never needs more than one Chromium at a time.
export const MAX_URLS_PER_RUN = 5;
export const DEEP_CRAWL_MAX_PAGES = 3;
export const DEEP_CRAWL_START_PAGE_ELEMENT_CAP = 100;
export const DEEP_CRAWL_EXTRA_PAGE_ELEMENT_CAP = 50;   // 100 + 2x50 = single-page token budget
export const WEBHOOK_TIMEOUT_MS = 5_000;
export const WEBHOOK_RETRY_DELAY_MS = 2_000;
export const MAX_AI_TEST_CASES = 8;
export const MAX_TEST_CASES = MAX_AI_TEST_CASES;
