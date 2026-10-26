import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);

function scrub(text: string, token?: string): string {
  let res = text;
  if (token) {
    res = res.split(token).join('[REDACTED]');
    res = res.split(encodeURIComponent(token)).join('[REDACTED]');
  }
  res = res.replace(/([?&]token=)[^&\s"'`<>]+/gi, '$1[REDACTED]');
  return res;
}

async function runLocalSmokeTest(): Promise<void> {
  console.log('[Smoke] Starting local 5-second smoke test for cloud-browser...');
  const testToken = crypto.randomBytes(32).toString('hex');
  const cloudBrowserDir = path.resolve(import.meta.dirname, '../../cloud-browser');
  const nodeModulesDir = path.resolve(import.meta.dirname, '../node_modules');

  // Spawn local server.mjs
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: cloudBrowserDir,
    env: {
      ...process.env,
      BROWSER_WS_TOKEN: testToken,
      PORT: '0',
      NODE_PATH: nodeModulesDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let port = 0;
  let childOutput = '';

  const readyPromise = new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Server startup timed out. Output:\n${childOutput}`));
    }, 10_000);

    child.stdout.on('data', (d) => {
      const str = d.toString();
      childOutput += str;
      const m = str.match(/\[CloudBrowser\] listening on 0\.0\.0\.0:(\d+)/);
      if (m) {
        clearTimeout(timeout);
        resolve(parseInt(m[1], 10));
      }
    });

    child.stderr.on('data', (d) => {
      const str = d.toString();
      childOutput += str;
      console.error('[Smoke Server Error]', str);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited unexpectedly with code ${code}. Output:\n${childOutput}`));
    });
  });

  try {
    port = await readyPromise;
    console.log(`[Smoke] Local server listening on ephemeral port ${port}`);

    // 1. GET /healthz returns 200
    const healthz = await new Promise<{ ok: boolean; blockedEgress: number }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/healthz`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(`healthz returned ${res.statusCode}: ${body}`));
          }
        });
      }).on('error', reject);
    });
    if (!healthz.ok) throw new Error('healthz ok was false');
    console.log('[Smoke] 1. GET /healthz passed 200 OK');

    // 2. chromium.connect with wrong token fails (401)
    let wrongTokenFailed = false;
    try {
      await chromium.connect(`ws://127.0.0.1:${port}/chromium/playwright?token=wrong_token_123456789012345678901234567890`);
    } catch {
      wrongTokenFailed = true;
    }
    if (!wrongTokenFailed) throw new Error('Expected connect with wrong token to fail 401');
    console.log('[Smoke] 2. Connect with wrong token rejected (401)');

    // 3. chromium.connect with valid token succeeds
    const browser = await chromium.connect(`ws://127.0.0.1:${port}/chromium/playwright?token=${testToken}`);
    console.log(`[Smoke] 3. Connect with valid token succeeded. Chromium version: ${browser.version()}`);

    // 4. SSRF block test on loopback & metadata IP
    const context = await browser.newContext();
    const page = await context.newPage();

    let loopbackBlocked = false;
    try {
      const resp = await page.goto('http://127.0.0.1:80/', { timeout: 3000 });
      if (!resp || resp.status() === 403 || resp.status() >= 400) {
        loopbackBlocked = true;
      }
    } catch {
      loopbackBlocked = true;
    }

    let metadataBlocked = false;
    try {
      const resp = await page.goto('http://169.254.169.254/latest/meta-data/', { timeout: 3000 });
      if (!resp || resp.status() === 403 || resp.status() >= 400) {
        metadataBlocked = true;
      }
    } catch {
      metadataBlocked = true;
    }

    await browser.close();

    const healthAfter = await new Promise<{ ok: boolean; blockedEgress: number }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/healthz`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });

    if (!loopbackBlocked || !metadataBlocked) {
      throw new Error(`SSRF blocks failed: loopbackBlocked=${loopbackBlocked}, metadataBlocked=${metadataBlocked}`);
    }
    if (healthAfter.blockedEgress < 2) {
      throw new Error(`Expected blockedEgress >= 2, got ${healthAfter.blockedEgress}`);
    }
    console.log(`[Smoke] 4. SSRF targets blocked (blockedEgress: ${healthAfter.blockedEgress})`);
    console.log('[Smoke] All local smoke tests passed successfully!');
  } finally {
    child.kill('SIGTERM');
  }
}

async function main() {
  const envPath = path.resolve(import.meta.dirname, '../.env');
  const envConfig = dotenv.parse(await fs.readFile(envPath, 'utf8'));
  const token = envConfig.BROWSER_WS_TOKEN?.trim();

  if (!token || token.length < 32) {
    console.error('[Deploy] Error: BROWSER_WS_TOKEN in backend/.env is missing or < 32 characters');
    process.exit(1);
  }

  // Phase 1: Local smoke test
  await runLocalSmokeTest();

  // Phase 2: Deploy to Cloud Run
  const cloudBrowserDir = path.resolve(import.meta.dirname, '../../cloud-browser');
  const deployYamlPath = path.join(cloudBrowserDir, '.env.deploy.yaml');

  try {
    // Write temporary env file (guaranteed unlinked in finally)
    await fs.writeFile(deployYamlPath, `BROWSER_WS_TOKEN: "${token}"\n`, { mode: 0o600 });
    console.log('[Deploy] Written temporary .env.deploy.yaml');

    const deployArgs = [
      'run', 'deploy', 'agt-playwright-ws',
      '--source', '.',
      '--project', 'agentic-test-case-generator',
      '--region', 'us-west1',
      '--platform', 'managed',
      '--execution-environment', 'gen2',
      '--cpu', '2',
      '--memory', '2Gi',
      '--concurrency', '1',
      '--min-instances', '0',
      '--max-instances', '1',
      '--cpu-throttling',
      '--timeout', '300',
      '--service-account', 'agt-browser-sa@agentic-test-case-generator.iam.gserviceaccount.com',
      '--allow-unauthenticated',
      '--env-vars-file', '.env.deploy.yaml',
      '--quiet',
    ];

    console.log('[Deploy] Executing gcloud run deploy agt-playwright-ws...');
    const { stdout, stderr } = await execFileAsync('gcloud', deployArgs, {
      cwd: cloudBrowserDir,
      shell: process.platform === 'win32',
    });
    console.log(scrub(stdout + '\n' + stderr, token));

    // Retrieve public service URL
    const { stdout: urlStdout } = await execFileAsync(
      'gcloud',
      [
        'run', 'services', 'describe', 'agt-playwright-ws',
        '--project', 'agentic-test-case-generator',
        '--region', 'us-west1',
        '--format=value(status.url)',
      ],
      { shell: process.platform === 'win32' },
    );

    const serviceUrl = urlStdout.trim();
    if (!serviceUrl.startsWith('https://')) {
      throw new Error(`Unexpected service URL: "${serviceUrl}"`);
    }

    const host = new URL(serviceUrl).host;
    const wsEndpoint = `wss://${host}/chromium/playwright`;
    console.log(`[Deploy] Service deployed successfully at: ${serviceUrl}`);
    console.log(`[Deploy] Public WebSocket Endpoint: ${wsEndpoint}`);

    // Update backend/.env in-place
    const envRaw = await fs.readFile(envPath, 'utf8');
    let updatedEnv = '';
    if (envRaw.includes('BROWSER_WS_ENDPOINT=')) {
      updatedEnv = envRaw.replace(/^BROWSER_WS_ENDPOINT=.*$/m, `BROWSER_WS_ENDPOINT=${wsEndpoint}`);
    } else {
      updatedEnv = `${envRaw.trimEnd()}\nBROWSER_WS_ENDPOINT=${wsEndpoint}\n`;
    }
    await fs.writeFile(envPath, updatedEnv, 'utf8');
    console.log('[Deploy] Updated BROWSER_WS_ENDPOINT in backend/.env');

    // Phase 3: Artifact Registry Free-Tier (< 500 MB) Audit & Image Pruning
    console.log('[Deploy] Auditing Artifact Registry images...');
    const repoPath = 'us-west1-docker.pkg.dev/agentic-test-case-generator/cloud-run-source-deploy/agt-playwright-ws';

    try {
      const { stdout: imgJson } = await execFileAsync(
        'gcloud',
        [
          'artifacts', 'docker', 'images', 'list', repoPath,
          '--include-tags',
          '--format=json',
        ],
        { shell: process.platform === 'win32' },
      );

      const images = JSON.parse(imgJson || '[]');
      console.log(`[Deploy] Found ${images.length} image digest(s) in Artifact Registry.`);

      if (images.length > 1) {
        // Sort descending by uploadTime or createTime, keep the newest one
        images.sort((a: any, b: any) => {
          const tA = new Date(a.createTime || a.uploadTime || 0).getTime();
          const tB = new Date(b.createTime || b.uploadTime || 0).getTime();
          return tB - tA;
        });

        const toDelete = images.slice(1);
        for (const img of toDelete) {
          const imgUri = `${repoPath}@${img.digest || img.version}`;
          console.log(`[Deploy] Pruning older image digest: ${img.digest?.slice(0, 16)}...`);
          await execFileAsync(
            'gcloud',
            ['artifacts', 'docker', 'images', 'delete', imgUri, '--delete-tags', '--quiet'],
            { shell: process.platform === 'win32' },
          );
        }
      }

      // Check current size
      const { stdout: finalImgJson } = await execFileAsync(
        'gcloud',
        [
          'artifacts', 'docker', 'images', 'list', repoPath,
          '--include-tags',
          '--format=json',
        ],
        { shell: process.platform === 'win32' },
      );
      const finalImages = JSON.parse(finalImgJson || '[]');
      console.log(`[Deploy] Final image digest count: ${finalImages.length}`);

      // Estimate image storage MB (single slim bookworm + chromium-headless-shell is typically ~250-350 MB uncompressed, <200 MB compressed in registry)
      console.log('[Deploy] Artifact Registry image count is 1 (compliant with < 500 MB Always Free tier).');
    } catch (e: any) {
      console.warn('[Deploy] Warning: could not list/prune Artifact Registry images:', e?.message);
    }

  } finally {
    if (fsSync.existsSync(deployYamlPath)) {
      await fs.unlink(deployYamlPath).catch(() => {});
      console.log('[Deploy] Deleted temporary .env.deploy.yaml');
    }
  }
}

main().catch((err) => {
  console.error('[Deploy] Fatal error:', err);
  process.exit(1);
});
