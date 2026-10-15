import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  reporter: [['json', { outputFile: 'results.json' }]],
  use: {
    actionTimeout: 10_000,
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 720 },
  },
});
