import path from 'node:path';

export const RUNNER_DIR = path.resolve(import.meta.dirname, '../../playwright-runner');
export const PLAYWRIGHT_CLI = path.join(RUNNER_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
export const RUNNER_TESTS_DIR = path.join(RUNNER_DIR, 'tests');

export const RUNNER_TIMEOUT_SCALE = Math.max(
  1,
  parseFloat(process.env.RUNNER_TIMEOUT_SCALE ?? '1') || 1,
);

export const STATIC_VALIDATION_TIMEOUT_MS = Math.round(30_000 * RUNNER_TIMEOUT_SCALE);
export const EXECUTION_TIMEOUT_MS = Math.round(60_000 * RUNNER_TIMEOUT_SCALE);
