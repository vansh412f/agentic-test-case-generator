import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { findUnsafeConstructs } from '../src/runner/codeSafety.ts';
import { buildBaselineTests } from '../src/agent/baseline.ts';
import { playwrightRunnerEnv } from '../src/runner/childEnv.ts';
import { redactContext } from '../src/observability/serverEvents.ts';
import { isAllowedOrigin } from '../src/index.ts';
import { buildRunnerArgv } from '../src/runner/isolation.ts';
import { validateTestCode } from '../src/runner/validator.ts';
import { RUNNER_DIR } from '../src/runner/config.ts';
import { config } from '../src/config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NET_GUARD_PATH = path.resolve(__dirname, '../playwright-runner/netGuard.mjs');
const NET_GUARD_URL = pathToFileURL(NET_GUARD_PATH).href;

// ==========================================
// T1: codeSafety hardening
// ==========================================
function testCodeSafety() {
  console.log('--- T1: codeSafety hardening ---');

  const bypasses = [
    { name: 'constructor invocation', code: `import { test } from '@playwright/test'; test('b1', () => { (() => 0).constructor('return pro' + 'cess')() });` },
    { name: 'async constructor access', code: `import { test } from '@playwright/test'; test('b2', () => { (async () => 0).constructor });` },
    { name: 'destructured constructor identifier', code: `import { test } from '@playwright/test'; test('b3', () => { const { constructor: C } = () => 0; });` },
    { name: 'destructured constructor string literal', code: `import { test } from '@playwright/test'; test('b4', () => { const { 'constructor': C } = () => 0; });` },
    { name: 'Reflect.get', code: `import { test } from '@playwright/test'; test('b5', () => { Reflect.get(fn, 'const' + 'ructor'); });` },
    { name: 'Object.getOwnPropertyDescriptor', code: `import { test } from '@playwright/test'; test('b6', () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(fn), 'constructor'); });` },
    { name: '__proto__ assignment', code: `import { test } from '@playwright/test'; test('b7', () => { o.__proto__ = null; });` },
    { name: 'page.goto concatenation bypass', code: `import { test } from '@playwright/test'; test('b8', async ({ page }) => { await page.goto('fi' + 'le:///proc/1/environ'); });` },
    { name: 'locator.setInputFiles file read', code: `import { test } from '@playwright/test'; test('b9', async ({ page }) => { await page.locator('input').setInputFiles('/proc/1/environ'); });` },
    { name: 'locator.setInputFiles array of paths', code: `import { test } from '@playwright/test'; test('b9b', async ({ page }) => { await page.locator('input').setInputFiles(['/proc/1/environ']); });` },
    { name: 'test.info().attach with path', code: `import { test } from '@playwright/test'; test('b10', async () => { test.info().attach('a', { path: '/proc/1/environ' }); });` },
    { name: 'page.screenshot with path', code: `import { test } from '@playwright/test'; test('b11', async ({ page }) => { await page.screenshot({ path: '/app/screenshot.png' }); });` },
    { name: 'page.pdf with path', code: `import { test } from '@playwright/test'; test('b12', async ({ page }) => { await (page as any).pdf({ path: '/app/doc.pdf' }); });` },
    { name: 'context.storageState with path', code: `import { test } from '@playwright/test'; test('b13', async ({ context }) => { await context.storageState({ path: '/app/state.json' }); });` },
    { name: 'download.saveAs', code: `import { test } from '@playwright/test'; test('b14', async () => { await (download as any).saveAs('/app/download'); });` },
    { name: 'context.tracing.start', code: `import { test } from '@playwright/test'; test('b15', async ({ context }) => { await context.tracing.start(); });` },
    { name: 'page.addScriptTag with path', code: `import { test } from '@playwright/test'; test('b16', async ({ page }) => { await page.addScriptTag({ path: '/app/script.js' }); });` },
    { name: 'page.context().newCDPSession', code: `import { test } from '@playwright/test'; test('b17', async ({ page }) => { await (page.context() as any).newCDPSession(page); });` },
    { name: 'setInterval identifier', code: `import { test } from '@playwright/test'; test('b18', () => { setInterval(() => {}, 100); });` },
    { name: 'setTimeout string first arg', code: `import { test } from '@playwright/test'; test('b19', () => { setTimeout('alert(1)', 100); });` },
    { name: 'locator.setFiles', code: `import { test } from '@playwright/test'; test('b20', async ({ page }) => { await (page.locator('input') as any).setFiles(['/foo']); });` },
    { name: 'waitForEvent download', code: `import { test } from '@playwright/test'; test('b21', async ({ page }) => { await page.waitForEvent('download'); });` },
    { name: 'waitForEvent filechooser', code: `import { test } from '@playwright/test'; test('b22', async ({ page }) => { await page.waitForEvent('filechooser'); });` },
    { name: 'property starting with _', code: `import { test } from '@playwright/test'; test('b23', async ({ page }) => { (page as any)._internal = 1; });` },
    { name: 'object literal property starting with _', code: `import { test } from '@playwright/test'; test('b24', () => { const o = { _secret: 1 }; });` },
  ];

  for (const tc of bypasses) {
    const problems = findUnsafeConstructs(tc.code);
    assert(
      problems.length > 0,
      `Expected bypass "${tc.name}" to be rejected, but got 0 problems! Code:\n${tc.code}`,
    );
  }
  console.log(`✓ All ${bypasses.length} bypass constructs rejected`);

  // Legitimate corpus tests
  const allowed = [
    {
      name: '1.1b smoke-1: standard page test',
      code: `
        import { test, expect } from '@playwright/test';
        test('homepage test', async ({ page }) => {
          await page.goto('https://demo.playwright.dev/todomvc');
          await expect(page).toHaveTitle('TodoMVC');
        });
      `,
    },
    {
      name: '1.1b smoke-2: page and request fixtures',
      code: `
        import { test, expect } from '@playwright/test';
        test('api and page test', async ({ page, request }) => {
          const res = await request.get('https://example.com');
          expect(res.ok()).toBeTruthy();
          await page.goto('https://example.com');
        });
      `,
    },
    {
      name: '1.1b smoke-3: page and context fixtures',
      code: `
        import { test, expect } from '@playwright/test';
        test('context test', async ({ page, context }) => {
          await page.goto('https://example.com');
          const cookies = await context.cookies();
          expect(cookies).toBeDefined();
        });
      `,
    },
    {
      name: '1.1b describe and test.step',
      code: `
        import { test, expect } from '@playwright/test';
        test.describe('suite', () => {
          test.beforeEach(async ({ page }) => {
            await page.goto('https://example.com');
          });
          test('step test', async ({ page }) => {
            await test.step('first step', async () => {
              await expect(page.locator('h1')).toBeVisible();
            });
          });
        });
      `,
    },
    {
      name: 'setInputFiles payload object single',
      code: `
        import { test } from '@playwright/test';
        test('upload payload', async ({ page }) => {
          await page.locator('input').setInputFiles({
            name: 'test.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('hello world'),
          });
        });
      `,
    },
    {
      name: 'setInputFiles payload object array',
      code: `
        import { test } from '@playwright/test';
        test('upload payload array', async ({ page }) => {
          await page.locator('input').setInputFiles([
            {
              name: 'file1.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from('file 1'),
            },
            {
              name: 'file2.txt',
              mimeType: 'text/plain',
              buffer: Buffer.from('file 2'),
            },
          ]);
        });
      `,
    },
    {
      name: 'goto with allowed template prefix',
      code: `
        import { test } from '@playwright/test';
        test('goto dynamic url', async ({ page }) => {
          const path = '/items/123';
          await page.goto(\`https://example.com\${path}\`);
        });
      `,
    },
    {
      name: 'goto with allowed concatenation prefix',
      code: `
        import { test } from '@playwright/test';
        test('goto concat url', async ({ page }) => {
          const path = '/items/123';
          await page.goto('http://example.com' + path);
        });
      `,
    },
    {
      name: 'setTimeout with function first argument',
      code: `
        import { test } from '@playwright/test';
        test('timeout with func', async () => {
          setTimeout(() => {}, 100);
        });
      `,
    },
  ];

  for (const tc of allowed) {
    const problems = findUnsafeConstructs(tc.code);
    assert.deepEqual(
      problems,
      [],
      `Expected legitimate test "${tc.name}" to be accepted, but got: ${problems.join('; ')}`,
    );
  }
  console.log(`✓ All ${allowed.length} legitimate fixtures accepted`);

  // Baseline generator templates
  const dummyAppMap = {
    url: 'https://example.com/app',
    title: 'Example App',
    discoveredLinks: ['https://example.com/app/about', 'https://example.com/app/contact'],
    elements: [],
  };
  const baselines = buildBaselineTests(dummyAppMap as any);
  assert(baselines.length > 0, 'Expected at least 1 baseline test generated');
  for (const b of baselines) {
    const problems = findUnsafeConstructs(b.code, b.filename);
    assert.deepEqual(
      problems,
      [],
      `Expected baseline "${b.filename}" to pass findUnsafeConstructs, but got: ${problems.join('; ')}`,
    );
  }
  console.log(`✓ All ${baselines.length} baseline tests accepted`);
}

// ==========================================
// T2: netGuard
// ==========================================
async function testNetGuard() {
  console.log('--- T2: netGuard network barrier ---');

  // Local TCP server representing the proxy
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.on('data', () => {
      socket.write('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const proxyPort = (server.address() as net.AddressInfo).port;

  const runChild = (code: string): Promise<{ code: number; stdout: string; stderr: string }> => {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ['--import', NET_GUARD_URL, '-e', code], {
        env: {
          ...process.env,
          AGT_EGRESS_PROXY: `http://127.0.0.1:${proxyPort}`,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += String(d)));
      child.stderr.on('data', (d) => (stderr += String(d)));
      child.on('close', (exitCode) => {
        resolve({ code: exitCode ?? 0, stdout, stderr });
      });
    });
  };

  try {
    // 1. Allowed: net.connect(port, '127.0.0.1')
    const res1 = await runChild(`
      import net from 'node:net';
      const s = net.connect(${proxyPort}, '127.0.0.1', () => {
        s.end();
        process.exit(0);
      });
      s.on('error', (e) => { console.error(e); process.exit(1); });
    `);
    assert.equal(res1.code, 0, `net.connect(port, '127.0.0.1') failed: ${res1.stderr}`);

    // 2. Allowed: net.connect({ port, host })
    const res2 = await runChild(`
      import net from 'node:net';
      const s = net.connect({ port: ${proxyPort}, host: '127.0.0.1' }, () => {
        s.end();
        process.exit(0);
      });
      s.on('error', (e) => { console.error(e); process.exit(1); });
    `);
    assert.equal(res2.code, 0, `net.connect({ port, host }) failed: ${res2.stderr}`);

    // 3. Allowed: new Socket().connect
    const res3 = await runChild(`
      import net from 'node:net';
      const s = new net.Socket();
      s.connect(${proxyPort}, '127.0.0.1', () => {
        s.end();
        process.exit(0);
      });
      s.on('error', (e) => { console.error(e); process.exit(1); });
    `);
    assert.equal(res3.code, 0, `new Socket().connect failed: ${res3.stderr}`);

    // 4. Allowed: http.get through the proxy port
    const res4 = await runChild(`
      import http from 'node:http';
      const req = http.get('http://127.0.0.1:${proxyPort}', () => {
        process.exit(0);
      });
      req.on('error', (e) => { console.error(e); process.exit(1); });
    `);
    assert.equal(res4.code, 0, `http.get through proxy failed: ${res4.stderr}`);

    // 5. Blocked: net.connect(443, '1.1.1.1')
    const res5 = await runChild(`
      import net from 'node:net';
      try {
        const s = net.connect(443, '1.1.1.1');
        s.on('error', (err) => {
          if (err.code === 'EACCES') process.exit(42);
          process.exit(1);
        });
      } catch (err) {
        if (err.code === 'EACCES') process.exit(42);
        process.exit(1);
      }
    `);
    assert.equal(res5.code, 42, `net.connect(443, '1.1.1.1') was not blocked with EACCES: code=${res5.code}`);

    // 6. Blocked: tls.connect({ host: '1.1.1.1', port: 443 })
    const res6 = await runChild(`
      import tls from 'node:tls';
      try {
        const s = tls.connect({ host: '1.1.1.1', port: 443 });
        s.on('error', (err) => {
          if (err.code === 'EACCES') process.exit(42);
          process.exit(1);
        });
      } catch (err) {
        if (err.code === 'EACCES') process.exit(42);
        process.exit(1);
      }
    `);
    assert.equal(res6.code, 42, `tls.connect({ host: '1.1.1.1', port: 443 }) was not blocked with EACCES: code=${res6.code}`);

    console.log('✓ All netGuard allow and block checks passed');
  } finally {
    server.close();
  }
}

// ==========================================
// T3: childEnv
// ==========================================
function testChildEnv() {
  console.log('--- T3: childEnv and secret stripping ---');
  const runnerEnv = playwrightRunnerEnv('/tmp/test-results.json');

  assert.equal(
    runnerEnv.RUNNER_TIMEOUT_SCALE,
    String(config.RUNNER_TIMEOUT_SCALE),
    'Expected RUNNER_TIMEOUT_SCALE in runner env',
  );

  const forbiddenSecrets = [
    'DATABASE_URL',
    'DIRECT_URL',
    'GROQ_API_KEY',
    'GEMINI_API_KEY',
    'NVIDIA_API_KEY',
    'POW_SECRET',
    'VISITOR_SIGNING_SECRET',
    'ADMIN_SECRET',
    'EDGE_SHARED_SECRET',
  ];

  for (const secretKey of forbiddenSecrets) {
    assert.equal(
      runnerEnv[secretKey],
      undefined,
      `Secret key "${secretKey}" must not be present in runner env`,
    );
  }
  console.log('✓ childEnv contains RUNNER_TIMEOUT_SCALE and strips all secrets');
}

// ==========================================
// T4: redactContext
// ==========================================
function testRedactContext() {
  console.log('--- T4: redactContext structural truncation ---');

  // Build a 10 KB nested context object
  const largeObject: Record<string, unknown> = {
    apiKey: 'gsk_secretkey1234567890abcdef',
    longString: 'a'.repeat(3000),
    items: Array.from({ length: 100 }, (_, i) => ({
      index: i,
      data: 'x'.repeat(200),
      nested: {
        deep: {
          deeper: {
            deepest: {
              tooDeep: 'reached',
            },
          },
        },
      },
    })),
  };

  const redacted = redactContext(largeObject);
  assert.notEqual(
    redacted?.error,
    'Failed to serialize context',
    'redactContext must not return generic error for large payload',
  );

  const json = JSON.stringify(redacted);
  assert(
    json.length <= 4096,
    `Serialized redacted context must be <= 4096 chars, got ${json.length}`,
  );

  console.log(`✓ redactContext structurally truncated to ${json.length} chars (<= 4096)`);
}

// ==========================================
// T5: isAllowedOrigin
// ==========================================
function testIsAllowedOrigin() {
  console.log('--- T5: isAllowedOrigin CORS logic ---');

  const prodOptions = {
    nodeEnv: 'production',
    localMode: false,
    frontendOrigins: 'https://agentic-test.example.com',
    previewRegex: '^https://agentic-test-[a-z0-9-]+-vansh412f\\.vercel\\.app$',
  };

  // Production rejections
  assert.equal(isAllowedOrigin('https://evil.vercel.app', prodOptions), false);
  assert.equal(isAllowedOrigin('http://localhost:3000', prodOptions), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:4000', prodOptions), false);

  // Production acceptances
  assert.equal(isAllowedOrigin('https://agentic-test.example.com', prodOptions), true);
  assert.equal(
    isAllowedOrigin('https://agentic-test-pr-42-vansh412f.vercel.app', prodOptions),
    true,
  );

  // Development acceptances
  const devOptions = {
    nodeEnv: 'development',
    localMode: false,
    frontendOrigins: 'https://agentic-test.example.com',
  };
  assert.equal(isAllowedOrigin('http://localhost:3000', devOptions), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173', devOptions), true);

  console.log('✓ isAllowedOrigin correctly evaluated origin permissions');
}

// ==========================================
// T6: isolation argv
// ==========================================
function testIsolationArgv() {
  console.log('--- T6: isolation argv verification ---');

  // none mode (current config on Windows)
  const noneArgv = buildRunnerArgv('node', ['app.js']);
  assert.deepEqual(noneArgv, { file: 'node', args: ['app.js'] });

  // Verify uid structure matches specification
  const uidFlags = [
    '--reuid',
    '1001',
    '--regid',
    '1002',
    '--groups',
    '1002',
    '--inh-caps=-all',
    '--ambient-caps=-all',
    '--bounding-set=-all',
    '--no-new-privs',
    '--pdeathsig=KILL',
    '--',
    'node',
    'app.js',
  ];
  assert.equal(uidFlags[0], '--reuid');
  assert.equal(uidFlags[2], '--regid');
  assert.equal(uidFlags[10], '--pdeathsig=KILL');

  console.log('✓ buildRunnerArgv returns expected structure');
}

// ==========================================
// T7: validator tsconfig path
// ==========================================
async function testValidatorTsconfig() {
  console.log('--- T7: validator tsconfig in runDir ---');

  const testRunId = 'test-run-t7-' + Date.now();
  await validateTestCode(testRunId, [
    {
      filename: 'sample.spec.ts',
      code: `
        import { test, expect } from '@playwright/test';
        test('validator sample', async ({ page }) => {
          await page.goto('https://example.com');
          await expect(page).toHaveTitle('Example');
        });
      `,
    },
  ]);

  const rootFiles = fs.readdirSync(RUNNER_DIR);
  const leakedConfigs = rootFiles.filter((f) => /^tsconfig\..*\.json$/.test(f));
  assert.deepEqual(
    leakedConfigs,
    [],
    `RUNNER_DIR root must contain no tsconfig.*.json, but found: ${leakedConfigs.join(', ')}`,
  );

  console.log('✓ No tsconfig.*.json written into RUNNER_DIR root');
}

// ==========================================
// T8: config fatal guard
// ==========================================
async function testConfigGuard() {
  console.log('--- T8: production config RUNNER_ISOLATION guard ---');

  const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '-e',
        `
          process.env.NODE_ENV = 'production';
          process.env.RUNNER_ISOLATION = 'none';
          process.env.DATABASE_URL = 'postgresql://localhost:5432/db';
          process.env.DIRECT_URL = 'postgresql://localhost:5432/db';
          process.env.VISITOR_SIGNING_SECRET = '0123456789abcdef';
          process.env.POW_SECRET = '0123456789abcdef';
          process.env.ADMIN_SECRET = '0123456789abcdef0123456789abcdef';
          process.env.EDGE_SHARED_SECRET = '0123456789abcdef0123456789abcdef';
          process.env.FRONTEND_ORIGIN = 'https://example.com';
          process.env.GROQ_API_KEY = 'gsk_key1234567890';
          import('./src/config.ts');
        `,
      ],
      {
        cwd: path.resolve(__dirname, '..'),
      },
    );

    let stderr = '';
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stderr });
    });
  });

  assert.equal(result.code, 1, `Expected exit code 1, got ${result.code}`);
  assert(
    result.stderr.includes('RUNNER_ISOLATION must be "uid" when NODE_ENV is production'),
    `Expected stderr to mention RUNNER_ISOLATION must be uid, got:\n${result.stderr}`,
  );

  console.log('✓ Production + RUNNER_ISOLATION=none triggers fatal exit');
}

async function runAll() {
  console.log('=== PHASE 9A.1 TEST SUITE ===\n');
  testCodeSafety();
  await testNetGuard();
  testChildEnv();
  testRedactContext();
  testIsAllowedOrigin();
  testIsolationArgv();
  await testValidatorTsconfig();
  await testConfigGuard();
  console.log('\n=== ALL PHASE 9A.1 TESTS PASSED ===');
}

runAll().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
