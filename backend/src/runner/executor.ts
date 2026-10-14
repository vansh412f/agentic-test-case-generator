import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  RUNNER_DIR,
  PLAYWRIGHT_CLI,
  RUNNER_TESTS_DIR,
  EXECUTION_TIMEOUT_MS,
} from './config.ts';

export interface TestCaseResult {
  testCaseId: string; // "tc-1" (derived from filename "tc-1.spec.ts")
  passed: boolean;
  durationMs: number;
  error?: string; // trimmed to last 30 lines, only present when passed=false
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

export async function executeTests(
  runId: string,
  files: Array<{ filename: string; code: string }>,
): Promise<ExecutionResult> {
  const runDir = path.join(RUNNER_TESTS_DIR, runId);
  const resultsPath = path.join(RUNNER_DIR, 'results.json');

  // 1. Write files to disk
  await fs.mkdir(runDir, { recursive: true });
  for (const file of files) {
    const filePath = path.join(runDir, file.filename);
    await fs.writeFile(filePath, file.code, 'utf-8');
  }

  // Ensure stale results.json from previous runs is removed
  try {
    await fs.rm(resultsPath, { force: true });
  } catch {
    // Ignore
  }

  try {
    // 2. Invoke Playwright CLI (use forward slashes for filter regex compatibility)
    const testArg = path.posix.join('tests', runId.replace(/\\/g, '/'));
    let processError: Error | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          process.execPath,
          [PLAYWRIGHT_CLI, 'test', testArg],
          { cwd: RUNNER_DIR, timeout: EXECUTION_TIMEOUT_MS },
          (err) => {
            if (err) {
              const errnoErr = err as NodeJS.ErrnoException;
              if (err.killed || err.signal === 'SIGTERM') {
                reject(new Error(`Execution timed out after ${EXECUTION_TIMEOUT_MS}ms`));
                return;
              }
              if (typeof errnoErr.code === 'string') {
                reject(err);
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
    } catch (err) {
      processError = err instanceof Error ? err : new Error(String(err));
    }

    if (processError) {
      return {
        success: false,
        results: files.map((f) => ({
          testCaseId: getTestCaseId(f.filename),
          passed: false,
          durationMs: 0,
          error: processError.message,
        })),
      };
    }

    // 3. Read and parse JSON reporter output
    let rawJson: string;
    try {
      rawJson = await fs.readFile(resultsPath, 'utf-8');
    } catch {
      return {
        success: false,
        results: files.map((f) => ({
          testCaseId: getTestCaseId(f.filename),
          passed: false,
          durationMs: 0,
          error: 'Playwright produced no results file',
        })),
      };
    }

    let report: PlaywrightJsonReport;
    try {
      report = JSON.parse(rawJson) as PlaywrightJsonReport;
    } catch {
      return {
        success: false,
        results: files.map((f) => ({
          testCaseId: getTestCaseId(f.filename),
          passed: false,
          durationMs: 0,
          error: 'Failed to parse Playwright results',
        })),
      };
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
              if (!firstErrorMessage) {
                firstErrorMessage =
                  res.error?.message ||
                  (res.status === 'timedOut'
                    ? 'Test timed out'
                    : `Test failed with status ${res.status}`);
              }
            }
          }
        }
      }

      results.push({
        testCaseId,
        passed,
        durationMs,
        ...(passed ? {} : { error: trimError(firstErrorMessage || 'Test failed') }),
      });
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
        });
      }
    }

    const success = results.length > 0 && results.every((r) => r.passed);
    return { success, results };
  } finally {
    // 5. Cleanup results.json
    try {
      await fs.rm(resultsPath, { force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}
