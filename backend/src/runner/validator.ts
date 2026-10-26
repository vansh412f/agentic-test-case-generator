import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { RUNNER_DIR, RUNNER_TESTS_DIR, STATIC_VALIDATION_TIMEOUT_MS } from './config.ts';
import { childProcessEnv } from './childEnv.ts';
import { findUnsafeConstructs } from './codeSafety.ts';
import { JobCancelledError } from '../agent/cancellation.ts';

import { heavyOpGate } from '../security/concurrencyGate.ts';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  perFile: Map<string, string[]>;
}

function parseFilenameFromDiagnostic(
  line: string,
  files: Array<{ filename: string }>,
): string | null {
  for (const file of files) {
    const escaped = file.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:[/\\\\]|^)${escaped}\\b`);
    if (regex.test(line)) {
      return file.filename;
    }
  }
  return null;
}

export async function validateTestCode(
  runId: string,
  files: Array<{ filename: string; code: string }>,
  options?: { signal?: AbortSignal },
): Promise<ValidationResult> {
  if (options?.signal?.aborted) {
    throw new JobCancelledError();
  }
  const perFile = new Map<string, string[]>();
  for (const file of files) {
    perFile.set(file.filename, []);
  }

  const unsafeErrors: string[] = [];
  for (const file of files) {
    const unsafe = findUnsafeConstructs(file.code, file.filename);
    if (unsafe.length > 0) {
      unsafeErrors.push(...unsafe);
      perFile.get(file.filename)!.push(...unsafe);
    }
  }
  if (unsafeErrors.length > 0) {
    return { valid: false, errors: unsafeErrors, perFile };
  }

  if (files.length === 0) {
    return { valid: true, errors: [], perFile };
  }

  const releaseGate = await heavyOpGate.acquirePipeline({ signal: options?.signal });

  const runDir = path.join(RUNNER_TESTS_DIR, runId);
  const tsconfigRunPath = path.join(runDir, 'tsconfig.json');

  try {
    // 1. Write files to disk
    await fs.mkdir(runDir, { recursive: true });
    for (const file of files) {
      const filePath = path.join(runDir, file.filename);
      await fs.writeFile(filePath, file.code, 'utf-8');
    }

    // 2. Write per-run scoped tsconfig inside runDir
    const runTsconfig = {
      extends: '../../tsconfig.json',
      include: ['./**/*.ts', '../../playwright.config.ts'],
    };
    await fs.writeFile(tsconfigRunPath, JSON.stringify(runTsconfig, null, 2), 'utf-8');

    // 3. Resolve tsc JS entry point
    const runnerTscJs = path.join(RUNNER_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
    const backendTscJs = path.resolve(RUNNER_DIR, '../node_modules/typescript/bin/tsc');
    const tscJs = fsSync.existsSync(runnerTscJs) ? runnerTscJs : backendTscJs;

    let childProcess: ChildProcess | undefined;

    const killChild = () => {
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
    };

    const onAbort = () => {
      killChild();
    };
    options?.signal?.addEventListener('abort', onAbort, { once: true });

    const tscExecution = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      childProcess = execFile(
        process.execPath,
        ['--max-old-space-size=160', '--max-semi-space-size=4', tscJs, '--noEmit', '--project', tsconfigRunPath],
        { cwd: RUNNER_DIR, env: childProcessEnv(), signal: options?.signal },
        (error, stdout, stderr) => {
          options?.signal?.removeEventListener('abort', onAbort);
          if (options?.signal?.aborted) {
            reject(new JobCancelledError());
            return;
          }
          if (error && typeof (error as NodeJS.ErrnoException).code === 'string') {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        },
      );

      childProcess.on('error', (err) => {
        options?.signal?.removeEventListener('abort', onAbort);
        if (options?.signal?.aborted) {
          reject(new JobCancelledError());
        } else {
          reject(err);
        }
      });
    });

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
      timer = setTimeout(() => {
        killChild();
        resolve({ timeout: true });
      }, STATIC_VALIDATION_TIMEOUT_MS);
    });

    const result = await Promise.race([tscExecution, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if ('timeout' in result) {
      await Promise.race([tscExecution.catch(() => undefined), new Promise((r) => setTimeout(r, 2_000))]);
      const timeoutMsg = 'Static validation timed out';
      for (const file of files) {
        perFile.get(file.filename)!.push(timeoutMsg);
      }
      return { valid: false, errors: [timeoutMsg], perFile };
    }

    const stdoutLines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const stderrLines = result.stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const allErrors = [...stdoutLines, ...stderrLines];
    if (allErrors.length > 0) {
      for (const line of allErrors) {
        const matched = parseFilenameFromDiagnostic(line, files);
        if (matched) {
          perFile.get(matched)!.push(line);
        } else {
          for (const file of files) {
            perFile.get(file.filename)!.push(line);
          }
        }
      }
      return { valid: false, errors: allErrors, perFile };
    }

    return { valid: true, errors: [], perFile };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const file of files) {
      perFile.get(file.filename)!.push(message);
    }
    return { valid: false, errors: [message], perFile };
  } finally {
    // 4. Clean up the run directory and per-run tsconfig
    try {
      await fs.rm(runDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
    try {
      await fs.rm(tsconfigRunPath, { force: true });
    } catch {
      // Ignore cleanup error
    }
    releaseGate();
  }
}
