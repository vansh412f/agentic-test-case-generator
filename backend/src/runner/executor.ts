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

export type FailureClass = 'finding' | 'locator' | 'timeout' | 'other';

export interface TestCaseResult {
  testCaseId: string; // "tc-1" (derived from filename "tc-1.spec.ts")
  passed: boolean;
  durationMs: number;
  error?: string; // trimmed to last 30 lines, only present when passed=false
  failureClass?: FailureClass;
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

const LOCATOR_REGEX = /element\(s\) not found|strict mode violation/;
const TIMEOUT_REGEX = /waiting for|Timeout/;

export function classifyExecutionError(message: string): FailureClass {
  const hasExpected = message.includes('Expected:');
  const hasReceived = message.includes('Received:');
  const matchesLocator = LOCATOR_REGEX.test(message);
  const matchesTimeout = TIMEOUT_REGEX.test(message);

  if (hasExpected && hasReceived && !matchesLocator && !matchesTimeout) {
    return 'finding';
  }
  if (matchesLocator) {
    return 'locator';
  }
  if (matchesTimeout) {
    return 'timeout';
  }
  return 'other';
}

function getTestCaseId(filenameOrTitle: string): string {
  const normalized = filenameOrTitle.replace(/\\/g, '/');
  return path.basename(normalized).replace(/\.spec\.ts$/, '');
}

function trimError(msg: string): string {
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

export interface ExecuteTestsOptions {
  secrets?: Map<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function executeTests(
  runId: string,
  files: Array<{ filename: string; code: string }>,
  options?: ExecuteTestsOptions,
): Promise<ExecutionResult> {
  const runDir = path.join(RUNNER_TESTS_DIR, runId);
  const resultsPath = path.join(runDir, 'results.json');
  const outputDir = path.join(runDir, 'artifacts');
  const executionTimeout = options?.timeoutMs ?? EXECUTION_TIMEOUT_MS;

  try {
    if (!fsSync.existsSync(PLAYWRIGHT_CLI)) {
      throw new RunnerError('BROWSER_ERROR', `Playwright CLI not found at ${PLAYWRIGHT_CLI}`);
    }

    // 1. Write files to disk (replacing secret tokens with escaped real values)
    await fs.mkdir(runDir, { recursive: true });
    for (const file of files) {
      let codeToWrite = file.code;
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

    await new Promise<void>((resolve, reject) => {
      let childProcess: ReturnType<typeof execFile> | undefined;

      const onAbort = () => {
        if (childProcess && !childProcess.killed) {
          if (process.platform === 'win32' && childProcess.pid) {
            try {
              execFile('taskkill', ['/pid', String(childProcess.pid), '/T', '/F'], () => {});
            } catch {}
          }
          try {
            childProcess.kill();
          } catch {}
        }
      };
      options?.signal?.addEventListener('abort', onAbort, { once: true });

      childProcess = execFile(
        process.execPath,
        [PLAYWRIGHT_CLI, 'test', testArg, '--output', outputDir],
        {
          cwd: RUNNER_DIR,
          timeout: executionTimeout,
          env: playwrightRunnerEnv(resultsPath),
          signal: options?.signal,
        },
        (err) => {
          options?.signal?.removeEventListener('abort', onAbort);
          if (options?.signal?.aborted) {
            reject(new JobCancelledError());
            return;
          }
          if (err) {
            const errnoErr = err as NodeJS.ErrnoException;
            if (err.killed || err.signal === 'SIGTERM') {
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
              const msg = redactSecrets(err.message, options?.secrets);
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
      const msg = redactSecrets(err instanceof Error ? err.message : String(err), options?.secrets);
      throw new RunnerError('NO_RESULTS', `Playwright produced no results file: ${msg}`, err);
    }

    let report: PlaywrightJsonReport;
    try {
      report = JSON.parse(rawJson) as PlaywrightJsonReport;
    } catch (err) {
      const msg = redactSecrets(err instanceof Error ? err.message : String(err), options?.secrets);
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

      for (const spec of specs) {
        for (const test of spec.tests || []) {
          for (const res of test.results || []) {
            if (typeof res.duration === 'number') {
              durationMs += res.duration;
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
              const errorText = stripAnsi(rawError);

              if (errorText.includes('browserType.launch')) {
                const redactedLaunch = redactSecrets(errorText, options?.secrets);
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
    return { success, results };
  } finally {
    // 5. Cleanup results.json and tests/<runId>/
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
}
