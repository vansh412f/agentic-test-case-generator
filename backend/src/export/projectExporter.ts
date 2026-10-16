import { readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Writable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import type { LoadedJob } from '../db/jobs.ts';
import { ExportError } from './errors.ts';

const packageJson: unknown = JSON.parse(readFileSync(new URL('../../playwright-runner/package.json', import.meta.url), 'utf8'));
const runnerVersion = z.object({
  dependencies: z.object({ '@playwright/test': z.string().regex(/^\d+\.\d+\.\d+$/) }),
}).parse(packageJson).dependencies['@playwright/test'];

export async function exportProject(job: LoadedJob, destination: Writable): Promise<void> {
  const tests = job.generatedTests.filter((test) => test.finalStatus !== 'gave_up');
  const names = new Set<string>();
  for (const test of tests) {
    const key = test.filename.toLowerCase();
    if (!/^[a-zA-Z0-9_-]+\.spec\.ts$/.test(test.filename) || names.has(key)) {
      throw new ExportError('INVALID_EXPORT_FILE', 'Stored test filenames are invalid or duplicated.');
    }
    names.add(key);
  }
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('warning', (error) => archive.destroy(error));
  const completed = pipeline(archive, destination);
  try {
    archive.append(JSON.stringify({
      name: `generated-tests-${job.id}`,
      private: true,
      type: 'module',
      scripts: { test: 'npx playwright test' },
      devDependencies: { '@playwright/test': runnerVersion },
    }, null, 2), { name: 'package.json' });
    archive.append(`import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  use: {
    baseURL: ${JSON.stringify(job.targetUrl)},
    actionTimeout: 10_000,
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
});
`, { name: 'playwright.config.ts' });
    for (const test of tests) archive.append(test.finalCode, { name: `tests/${test.filename}` });
    archive.append(`# Generated Playwright test project

Job: ${job.id}
Target URL (JSON encoded): ${JSON.stringify(job.targetUrl)}

Requires Node.js 20 or newer and a running target application reachable from this machine.
Review the generated code before running it. Tests may change application data.
Tests that found application bugs are included and may still fail. gave_up tests are excluded.

Run these commands from this directory:

    npm install
    npx playwright install chromium
    npm test

On a Linux machine without browser system dependencies, use:

    npx playwright install --with-deps chromium

The baseURL is set in playwright.config.ts. Tests may also contain absolute URLs;
update those if you move the target application. A localhost target must run on the machine executing these tests.
`, { name: 'README.md' });
    await Promise.all([completed, archive.finalize()]);
  } catch (cause) {
    archive.destroy(cause instanceof Error ? cause : new Error(String(cause)));
    await completed.catch(() => undefined);
    throw new ExportError('EXPORT_FAILED', 'Could not stream the test project archive.', cause);
  }
}
