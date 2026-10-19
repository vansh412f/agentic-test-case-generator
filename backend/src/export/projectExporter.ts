import { readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Writable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import type { LoadedJob } from '../db/jobs.ts';
import { ExportError } from './errors.ts';

const packageJson: unknown = JSON.parse(readFileSync(new URL('../../playwright-runner/package.json', import.meta.url), 'utf8'));
const runnerVersion = z.object({
  dependencies: z.object({
    '@playwright/test': z.string().regex(/^\d+\.\d+\.\d+$/),
    '@axe-core/playwright': z.string().optional(),
  }),
}).parse(packageJson).dependencies['@playwright/test'];
const axeVersion = (packageJson as { dependencies?: Record<string, string> })?.dependencies?.['@axe-core/playwright'] ?? '^4.14.0';

export function rewriteBaseUrl(code: string, targetUrl: string): string {
  const jsonTarget = JSON.stringify(targetUrl);
  let rewritten = code.replaceAll(`page.goto(${jsonTarget})`, `page.goto(process.env.BASE_URL ?? ${jsonTarget})`);
  const singleQuoted = `'${targetUrl.replace(/'/g, "\\'")}'`;
  rewritten = rewritten.replaceAll(`page.goto(${singleQuoted})`, `page.goto(process.env.BASE_URL ?? ${jsonTarget})`);
  return rewritten;
}

export function isLoopbackOrPrivate(urlStr: string): boolean {
  try {
    const hostname = new URL(urlStr).hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('127.') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]'
    ) {
      return true;
    }
    if (
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function transformSecretTokens(code: string): { code: string; tokens: string[] } {
  const foundTokens = new Set<string>();
  const transformed = code.replace(/(['"])(__AGT_SECRET_(\d+)__)\1/g, (_, _quote, _token, num) => {
    foundTokens.add(`AGT_SECRET_${num}`);
    return `(process.env.AGT_SECRET_${num} ?? '')`;
  });
  return { code: transformed, tokens: [...foundTokens].sort() };
}

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
    const hasA11yTest = tests.some((test) => test.filename.includes('smoke-3') || test.finalCode.includes('@axe-core/playwright'));

    archive.append(JSON.stringify({
      name: `generated-tests-${job.id}`,
      private: true,
      type: 'module',
      scripts: { test: 'npx playwright test' },
      devDependencies: {
        '@playwright/test': runnerVersion,
        ...(hasA11yTest ? { '@axe-core/playwright': axeVersion } : {}),
      },
    }, null, 2), { name: 'package.json' });

    archive.append(`import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? ${JSON.stringify(job.targetUrl)},
    actionTimeout: 10_000,
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
});
`, { name: 'playwright.config.ts' });

    const allSecretTokens = new Set<string>();
    for (const test of tests) {
      const codeWithBaseUrl = rewriteBaseUrl(test.finalCode, job.targetUrl);
      const { code, tokens } = transformSecretTokens(codeWithBaseUrl);
      tokens.forEach((t) => allSecretTokens.add(t));
      archive.append(code, { name: `tests/${test.filename}` });
    }

    const secretList = [...allSecretTokens].sort();
    if (secretList.length > 0) {
      const envExampleContent = secretList.map((token) => `${token}=`).join('\n') + '\n';
      archive.append(envExampleContent, { name: '.env.example' });
    }

    const isLocalTarget = isLoopbackOrPrivate(job.targetUrl);
    const triggerSection = isLocalTarget
      ? `# Note: The target URL was a local address (${job.targetUrl}).
# In GitHub Actions, you must provide a reachable, deployed BASE_URL in repository variables or workflow dispatch input.
name: Playwright tests
on:
  workflow_dispatch:
    inputs:
      base_url: { description: 'URL to test (defaults to the generated target)', required: false }`
      : `name: Playwright tests
on:
  workflow_dispatch:
    inputs:
      base_url: { description: 'URL to test (defaults to the generated target)', required: false }
  push: { branches: [main] }
  pull_request:
  # schedule:
  #   - cron: '0 3 * * *'   # GitHub disables schedules after 60 days without repo activity`;

    const secretEnvSection = secretList.length > 0
      ? '\n' + secretList.map((token) => `          ${token}: \${{ secrets.${token} }}`).join('\n')
      : '';

    const workflowContent = `${triggerSection}
jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      BASE_URL: \${{ github.event.inputs.base_url || vars.BASE_URL || ${JSON.stringify(job.targetUrl)} }}${secretEnvSection}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: \${{ !cancelled() }}
        with: { name: playwright-report, path: playwright-report/, retention-days: 14 }
`;

    archive.append(workflowContent, { name: '.github/workflows/playwright.yml' });

    const envReadmeSection = secretList.length > 0 ? `
## Environment Variables
This test suite uses environment variables for sensitive test credentials:
${secretList.map((t) => `- \`${t}\``).join('\n')}

Set these variables before running the tests:

PowerShell:
${secretList.map((t) => `$env:${t}="your_secret_value"`).join('\n')}

Bash:
${secretList.map((t) => `export ${t}="your_secret_value"`).join('\n')}
` : '';

    const githubActionsReadmeSection = `
## Run in GitHub Actions
A workflow file has been generated at \`.github/workflows/playwright.yml\`.

To run this workflow in GitHub Actions:
1. Push this project to a GitHub repository.
2. (Optional) Set the repository variable \`BASE_URL\` under **Settings > Secrets and variables > Actions > Variables** if you want to target a staging or production URL.${isLocalTarget ? '\n   *(Required for local targets: point BASE_URL to your deployed staging/production environment)*' : ''}
${secretList.length > 0 ? `3. Configure the following repository secrets under **Settings > Secrets and variables > Actions > Secrets**:\n${secretList.map((t) => `   - \`${t}\``).join('\n')}\n` : ''}4. Trigger the workflow manually via the **Actions** tab ("Run workflow")${!isLocalTarget ? ' or push to `main`' : ''}.
`;

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

The baseURL is set in playwright.config.ts (or overridden with the BASE_URL environment variable). Tests may also contain absolute URLs;
update those if you move the target application. A localhost target must run on the machine executing these tests.
${envReadmeSection}
${githubActionsReadmeSection}`, { name: 'README.md' });

    await Promise.all([completed, archive.finalize()]);
  } catch (cause) {
    archive.destroy(cause instanceof Error ? cause : new Error(String(cause)));
    await completed.catch(() => undefined);
    throw new ExportError('EXPORT_FAILED', 'Could not stream the test project archive.', cause);
  }
}
// Module component implementation.
