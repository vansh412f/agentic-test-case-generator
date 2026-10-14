import path from 'node:path';

export const RUNNER_DIR = path.resolve(import.meta.dirname, '../../playwright-runner');
export const PLAYWRIGHT_CLI = path.join(RUNNER_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
export const RUNNER_TESTS_DIR = path.join(RUNNER_DIR, 'tests');
export const STATIC_VALIDATION_TIMEOUT_MS = 30_000;
export const EXECUTION_TIMEOUT_MS = 60_000;
