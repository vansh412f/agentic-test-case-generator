import { sanitizeError } from './sanitizeError.ts';
import { rewritePlaywrightImport } from './rewriteImport.ts';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  RUNNER_DIR,
  PLAYWRIGHT_CLI,
  RUNNER_TESTS_DIR,
  EXECUTION_TIMEOUT_MS,
} from './config.ts';
import { RunnerError } from './errors.ts';
import { playwrightRunnerEnv } from './childEnv.ts';
import { JobCancelledError } from '../agent/cancellation.ts';
import { ensureEgressProxy } from '../security/egressProxy.ts';
import { config } from '../config.ts';
import { isRemoteBrowserActive } from '../browser/remoteBrowser.ts';
import {
  buildRunnerArgv,
  reapRunner,
  isSelfCheckPassed,
  withRunnerIsolationLock,
} from './isolation.ts';
import { logger } from '../observability/logger.ts';

import { heavyOpGate } from '../security/concurrencyGate.ts';

export type FailureClass = 'finding' | 'locator' | 'timeout' | 'other';

export interface TestCaseResult {
  testCaseId: string; // "tc-1" (derived from filename "tc-1.spec.ts")
  passed: boolean;
  durationMs: number;
  error?: string; // trimmed to last 30 lines, only present when passed=false
  failureClass?: FailureClass;
  failureContext?: { finalUrl: string; navigations: string[] };
}

export interface ExecutionResult {
  success: boolean; // true only if ALL test cases passed
  results: TestCaseResult[];
}

interface PlaywrightJsonResult {
  status?: string;
  duration?: number;
  error?: {
    message?: string;
    stack?: string;
    value?: string;
  };
  errors?: Array<{ message?: string }>;
  attachments?: Array<{ name: string; contentType: string; path?: string; body?: string }>;
}

interface PlaywrightJsonTest {
  results?: PlaywrightJsonResult[];
}

interface PlaywrightJsonSpec {
  title?: string;
  tests?: PlaywrightJsonTest[];
}

interface PlaywrightJsonSuite {
  title?: string;
  specs?: PlaywrightJsonSpec[];
  suites?: PlaywrightJsonSuite[];
}

interface PlaywrightJsonReport {
  suites?: PlaywrightJsonSuite[];
  stats?: {
    expected?: number;
    unexpected?: number;
    flaky?: number;
    skipped?: number;
  };
}

export function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

const LOCATOR_REGEX =
  /element\(s\) not found|strict mode violation|resolved to \d+ elements|waiting for (?:getBy|locator)\(.*\)$(?![\s\S]*resolved to)/m;
const TEST_TIMEOUT_REGEX = /Test timeout of \d+ms exceeded/;
const ACTION_TIMEOUT_REGEX = /locator\.\w+:\s*Timeout/;
const RECEIVED_LINE_REGEX = /Received(?:\s+\w+)?:(?:\s*)(.*)/;
const CALL_LOG_RESOLVED_REGEX = /locator resolved to|unexpected value/;

export function classifyExecutionError(message: string): FailureClass {
  // 1. finding: an expect() failure where the element/page DID resolve:
  // a Received…: line whose value is not <element(s) not found>, OR the call log contains
  // `locator resolved to` / `unexpected value`. Do not exclude on `Timeout:`, because expect retries always print it.
  const hasExpect = message.includes('expect(') || message.includes('Expected:');
  const receivedMatch = RECEIVED_LINE_REGEX.exec(message);
  if (hasExpect) {
    if (
      /^\s*[-+] (Expected|Received)\b/m.test(message) ||
      message.includes('serializes to the same string') ||
      message.includes('deep equality')
    ) {
      return 'finding';
    }
    if (receivedMatch) {
      const receivedVal = receivedMatch[1]?.trim() ?? '';
      if (!receivedVal.includes('<element(s) not found>')) {
        return 'finding';
      }
    }
    if (CALL_LOG_RESOLVED_REGEX.test(message) && message.includes('unexpected value')) {
      return 'finding';
    }
  }

  // 2. timeout: `Test timeout of`, or an action timeout (`locator.<action>: Timeout`) with no expect diff
  if (TEST_TIMEOUT_REGEX.test(message) || ACTION_TIMEOUT_REGEX.test(message)) {
    return 'timeout';
  }

  // 3. locator: element(s) not found | strict mode violation | resolved to N elements | waiting for locator without resolved to
  if (LOCATOR_REGEX.test(message)) {
    return 'locator';
  }

  // 4. other: everything else
  return 'other';
}

function getTestCaseId(filenameOrTitle: string): string {
  const normalized = filenameOrTitle.replace(/\\/g, '/');
  return path.basename(normalized).replace(/\.spec\.ts$/, '');
}

export function trimError(msg: string): string {
  const lines = msg.split(/\r?\n/);
  if (lines.length <= 30) {
    return msg;
  }
  return lines.slice(-30).join('\n');
}

function collectSpecs(suite: PlaywrightJsonSuite): PlaywrightJsonSpec[] {
  const specs: PlaywrightJsonSpec[] = [...(suite.specs || [])];
  if (suite.suites) {
    for (const subSuite of suite.suites) {
      specs.push(...collectSpecs(subSuite));
    }
  }
  return specs;
}

export function redactSecrets(text: string, secrets?: Map<string, string>): string {
  if (!secrets || secrets.size === 0 || !text) return text;
  let redacted = text;
  for (const [token, secretValue] of secrets.entries()) {
    if (!secretValue) continue;
    const jsonEscaped = JSON.stringify(secretValue).slice(1, -1);
    if (jsonEscaped) {
      redacted = redacted.split(jsonEscaped).join(token);
    }
    redacted = redacted.split(secretValue).join(token);
  }
  return redacted;
}

async function findLargestTraceZip(dir: string, depth: number): Promise<string | undefined> {
  let best: { filePath: string; size: number } | undefined;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) {
      const nested = await findLargestTraceZip(entryPath, depth - 1);
      if (nested) {
        const size = (await fs.stat(nested)).size;
        if (!best || size > best.size) best = { filePath: nested, size };
      }
    } else if (entry.isFile() && entry.name === 'trace.zip') {
      const size = (await fs.stat(entryPath)).size;
      if (!best || size > best.size) best = { filePath: entryPath, size };
    }
  }
  return best?.filePath;
}

async function findAllTraceZips(dir: string, depth: number): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) {
      const nested = await findAllTraceZips(entryPath, depth - 1);
      results.push(...nested);
    } else if (entry.isFile() && (entry.name === 'trace.zip' || entry.name.endsWith('.zip'))) {
      results.push(entryPath);
    }
  }
  return results;
}

export interface ExecuteTestsOptions {
  secrets?: Map<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  trace?: boolean;
  onTraceZip?: (zipPath: string) => Promise<void>;
  onTraceZips?: (traces: Map<string, string>) => Promise<void>;
}

export async function executeTests(
  runId: string,
  files: Array<{ filename: string; code: string }>,
  options?: ExecuteTestsOptions,
): Promise<ExecutionResult> {
  const releaseGate = await heavyOpGate.acquirePipeline({ signal: options?.signal });
  try {
    return await withRunnerIsolationLock(async () => {
    if (config.RUNNER_ISOLATION === 'uid' && !isSelfCheckPassed()) {
      throw new RunnerError(
        'RUNNER_UNAVAILABLE',
        'Test execution is temporarily unavailable.',
      );
    }

    const runDir = path.join(RUNNER_TESTS_DIR, runId);
    const resultsPath = path.join(runDir, 'results.json');
    const outputDir = path.join(runDir, 'artifacts');
    const homeDir = path.join(runDir, '.home');
    const cacheDir = path.join(runDir, '.cache');
    const executionTimeout = options?.timeoutMs ?? EXECUTION_TIMEOUT_MS;

    try {
      if (!fsSync.existsSync(PLAYWRIGHT_CLI)) {
        throw new RunnerError('BROWSER_ERROR', `Playwright CLI not found at ${PLAYWRIGHT_CLI}`);
      }

      if (!isRemoteBrowserActive()) {
        await ensureEgressProxy();
      }

      // 1. Write files to disk (replacing secret tokens with escaped real values)
      await fs.mkdir(runDir, { recursive: true });
      await fs.mkdir(homeDir, { recursive: true });
      await fs.mkdir(cacheDir, { recursive: true });
      if (config.RUNNER_ISOLATION === 'uid') {
        try {
          await fs.chmod(runDir, 0o2770);
          await fs.chmod(homeDir, 0o2770);
          await fs.chmod(cacheDir, 0o2770);
        } catch {
          // Ignore chmod error on unsupported filesystems
        }
      }

      for (const file of files) {
        let codeToWrite = file.code;
        try {
          codeToWrite = rewritePlaywrightImport(codeToWrite, '../../agt-capture.ts');
        } catch (err) {
          logger.warn(`Failed to rewrite import for ${file.filename}`, {
            component: 'Executor',
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (options?.secrets && options.secrets.size > 0) {
          for (const [token, secretValue] of options.secrets.entries()) {
            const escaped = JSON.stringify(secretValue).slice(1, -1);
            codeToWrite = codeToWrite.split(token).join(escaped);
          }
        }
        const filePath = path.join(runDir, file.filename);
        await fs.writeFile(filePath, codeToWrite, 'utf-8');
      }

      // Ensure stale results.json from previous runs is removed
      try {
        await fs.rm(resultsPath, { force: true });
      } catch {
        // Ignore
      }

      if (options?.signal?.aborted) {
        throw new JobCancelledError();
      }

      // 2. Invoke Playwright CLI (use forward slashes for filter regex compatibility)
      const testArg = path.posix.join('tests', runId.replace(/\\/g, '/'));
      const { file: runnerCmd, args: runnerArgs } = buildRunnerArgv(process.execPath, [
        PLAYWRIGHT_CLI,
        'test',
        testArg,
        '--output',
        outputDir,
        ...(options?.trace ? ['--trace', 'on'] : []),
      ]);

      const runnerEnv = playwrightRunnerEnv(resultsPath, {
        HOME: homeDir,
        XDG_CACHE_HOME: cacheDir,
      });

      await new Promise<void>((resolve, reject) => {
        let childProcess: ReturnType<typeof execFile> | undefined;
        let timedOut = false;
        let timeoutTimer: NodeJS.Timeout | undefined;

        const killRunner = () => {
          if (config.RUNNER_ISOLATION === 'uid') {
            void reapRunner();
          } else {
            if (childProcess && !childProcess.killed) {
              if (process.platform === 'win32' && childProcess.pid) {
                try {
                  execFile('taskkill', ['/pid', String(childProcess.pid), '/T', '/F'], () => {});
                } catch {}
              }
              try {
                childProcess.kill('SIGKILL');
              } catch {}
            }
          }
        };

        const onAbort = () => {
          killRunner();
        };
        options?.signal?.addEventListener('abort', onAbort, { once: true });

        timeoutTimer = setTimeout(() => {
          timedOut = true;
          killRunner();
        }, executionTimeout);

        childProcess = execFile(
          runnerCmd,
          runnerArgs,
          {
            cwd: RUNNER_DIR,
            env: runnerEnv,
            signal: options?.signal,
          },
          async (err) => {
            if (timeoutTimer) clearTimeout(timeoutTimer);
            options?.signal?.removeEventListener('abort', onAbort);
            if (options?.signal?.aborted) {
              await reapRunner();
              reject(new JobCancelledError());
              return;
            }
            if (timedOut) {
              await reapRunner();
              reject(
                new RunnerError(
                  'EXECUTION_TIMEOUT',
                  `Execution timed out after ${executionTimeout}ms`,
                  err ?? undefined,
                ),
              );
              return;
            }
            if (err) {
              const errnoErr = err as NodeJS.ErrnoException;
              if (err.killed || err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
                await reapRunner();
                reject(
                  new RunnerError(
                    'EXECUTION_TIMEOUT',
                    `Execution timed out after ${executionTimeout}ms`,
                    err,
                  ),
                );
                return;
              }
              if (typeof errnoErr.code === 'string') {
                const msg = sanitizeError(trimError(redactSecrets(err.message, options?.secrets)));
                reject(
                  new RunnerError(
                    'BROWSER_ERROR',
                    `Failed to spawn Playwright runner: ${msg}`,
                    err,
                  ),
                );
                return;
              }
              // Normal test failure exit code (e.g. 1)
              resolve();
            } else {
              resolve();
            }
          },
        );
      });

    // 3. Read and parse JSON reporter output
    let rawJson: string;
    try {
      rawJson = await fs.readFile(resultsPath, 'utf-8');
    } catch (err) {
      const msg = sanitizeError(trimError(redactSecrets(err instanceof Error ? err.message : String(err), options?.secrets)));
      throw new RunnerError('NO_RESULTS', `Playwright produced no results file: ${msg}`, err);
    }

    let report: PlaywrightJsonReport;
    try {
      report = JSON.parse(rawJson) as PlaywrightJsonReport;
    } catch (err) {
      const msg = sanitizeError(trimError(redactSecrets(err instanceof Error ? err.message : String(err), options?.secrets)));
      throw new RunnerError('PARSE_ERROR', `Failed to parse Playwright results: ${msg}`, err);
    }

    const results: TestCaseResult[] = [];
    const suites = report.suites || [];

    for (const suite of suites) {
      const suiteTitle = suite.title || '';
      const testCaseId = getTestCaseId(suiteTitle);
      const specs = collectSpecs(suite);

      let passed = true;
      let durationMs = 0;
      let firstErrorMessage: string | undefined;
      let failureContext: { finalUrl: string; navigations: string[] } | undefined;

      for (const spec of specs) {
        for (const test of spec.tests || []) {
          for (const res of test.results || []) {
            if (typeof res.duration === 'number') {
              durationMs += res.duration;
            }
            if (res.attachments) {
              for (const att of res.attachments) {
                if (att.name === 'agt-failure-context') {
                  try {
                    let jsonStr = '';
                    if (att.body) {
                      try {
                        const decoded = Buffer.from(att.body, 'base64').toString('utf-8');
                        if (decoded.includes('{') && decoded.includes('finalUrl')) {
                          jsonStr = decoded;
                        } else {
                          jsonStr = att.body;
                        }
                      } catch {
                        jsonStr = att.body;
                      }
                    } else if (att.path && fsSync.existsSync(att.path)) {
                      jsonStr = fsSync.readFileSync(att.path, 'utf-8');
                    }
                    if (jsonStr) {
                      failureContext = JSON.parse(jsonStr);
                    }
                  } catch {
                    // Ignore attachment parse failure
                  }
                }
              }
            }
            if (res.status !== 'passed') {
              passed = false;
              const fallback =
                res.status === 'timedOut'
                  ? 'Test timed out'
                  : `Test failed with status ${res.status}`;
              const rawError =
                (res.errors ?? [])
                  .map((e) => e.message)
                  .filter(Boolean)
                  .join('\n\n') ||
                res.error?.message ||
                fallback;
              const errorText = sanitizeError(rawError);

              if (errorText.includes('browserType.launch') || errorText.includes('browserType.connect')) {
                const redactedLaunch = trimError(redactSecrets(errorText, options?.secrets));
                throw new RunnerError('BROWSER_ERROR', redactedLaunch);
              }

              if (!firstErrorMessage) {
                firstErrorMessage = errorText;
              }
            }
          }
        }
      }

      if (passed) {
        results.push({
          testCaseId,
          passed: true,
          durationMs,
        });
      } else {
        const errorText = firstErrorMessage || 'Test failed';
        const redacted = redactSecrets(errorText, options?.secrets);
        const trimmed = trimError(redacted);
        results.push({
          testCaseId,
          passed: false,
          durationMs,
          error: trimmed,
          failureClass: classifyExecutionError(redacted),
          failureContext,
        });
      }
    }

    // Ensure all expected files have a result entry
    const seenIds = new Set(results.map((r) => r.testCaseId));
    for (const file of files) {
      const expectedId = getTestCaseId(file.filename);
      if (!seenIds.has(expectedId)) {
        results.push({
          testCaseId: expectedId,
          passed: false,
          durationMs: 0,
          error: 'Test case was not reported by Playwright',
          failureClass: 'other',
        });
      }
    }

    const success = results.length > 0 && results.every((r) => r.passed);
    // Trace harvest (opt-in): runDir is deleted in the finally below, so the
    // zip must be copied out here. Tracing must never fail the run.
    if (options?.trace && (options.onTraceZips || options.onTraceZip)) {
      try {
        const traceMap = new Map<string, string>();

        // 1. JSON attachments primary
        for (const suite of suites) {
          const fileStem = getTestCaseId(suite.title || '');
          if (!fileStem) continue;
          const specs = collectSpecs(suite);
          for (const spec of specs) {
            for (const test of spec.tests || []) {
              for (const res of test.results || []) {
                if (res.attachments) {
                  for (const att of res.attachments) {
                    if (
                      (att.name === 'trace' || att.path?.endsWith('.zip') || att.contentType === 'application/zip') &&
                      att.path &&
                      fsSync.existsSync(att.path)
                    ) {
                      traceMap.set(fileStem, att.path);
                    }
                  }
                }
              }
            }
          }
        }

        // 2. outputDir scan fallback
        const remainingFiles = files.filter((f) => !traceMap.has(getTestCaseId(f.filename)));
        if (remainingFiles.length > 0) {
          const allZips = await findAllTraceZips(outputDir, 4);
          for (const file of remainingFiles) {
            const stem = getTestCaseId(file.filename);
            const matchedZip = allZips.find((z) => {
              const norm = z.replace(/\\/g, '/');
              return norm.includes(`/${stem}-`) || norm.includes(`/${stem}/`) || norm.includes(stem);
            });
            if (matchedZip) {
              traceMap.set(stem, matchedZip);
            }
          }
          if (files.length === 1 && allZips.length >= 1 && !traceMap.has(getTestCaseId(files[0].filename))) {
            traceMap.set(getTestCaseId(files[0].filename), allZips[0]);
          }
        }

        if (options.onTraceZips) {
          await options.onTraceZips(traceMap);
        }

        if (options.onTraceZip) {
          let largestZip: string | undefined;
          let largestSize = -1;
          for (const zipPath of traceMap.values()) {
            try {
              const sz = (await fs.stat(zipPath)).size;
              if (sz > largestSize) {
                largestSize = sz;
                largestZip = zipPath;
              }
            } catch {}
          }
          if (!largestZip) {
            largestZip = await findLargestTraceZip(outputDir, 3);
          }
          if (largestZip) {
            await options.onTraceZip(largestZip);
          }
        }
      } catch (err) {
        logger.warn('trace capture failed', {
          component: 'Executor',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { success, results };
    } finally {
      // 5. Cleanup: reapRunner BEFORE fs.rm
      try {
        await reapRunner();
      } catch {
        // Ignore reaper error
      }
      try {
        await fs.rm(resultsPath, { force: true });
      } catch {
        // Ignore cleanup error
      }
      try {
        await fs.rm(runDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
    }
  });
  } finally {
    releaseGate();
  }
}
