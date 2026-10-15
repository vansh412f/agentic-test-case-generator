import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { RUNNER_DIR, RUNNER_TESTS_DIR, STATIC_VALIDATION_TIMEOUT_MS } from './config.ts';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export async function validateTestCode(
  runId: string,
  files: Array<{ filename: string; code: string }>,
): Promise<ValidationResult> {
  const runDir = path.join(RUNNER_TESTS_DIR, runId);
  const tsconfigRunPath = path.join(RUNNER_DIR, `tsconfig.${runId}.json`);

  try {
    // 1. Write files to disk
    await fs.mkdir(runDir, { recursive: true });
    for (const file of files) {
      const filePath = path.join(runDir, file.filename);
      await fs.writeFile(filePath, file.code, 'utf-8');
    }

    // 2. Write per-run scoped tsconfig
    const includePattern = `tests/${runId.replace(/\\/g, '/')}/**/*.ts`;
    const runTsconfig = {
      extends: './tsconfig.json',
      include: [includePattern, 'playwright.config.ts'],
    };
    await fs.writeFile(tsconfigRunPath, JSON.stringify(runTsconfig, null, 2), 'utf-8');

    // 3. Resolve tsc JS entry point
    const runnerTscJs = path.join(RUNNER_DIR, 'node_modules', 'typescript', 'bin', 'tsc');
    const backendTscJs = path.resolve(RUNNER_DIR, '../node_modules/typescript/bin/tsc');
    const tscJs = fsSync.existsSync(runnerTscJs) ? runnerTscJs : backendTscJs;

    let childProcess: ChildProcess | undefined;

    const tscExecution = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      childProcess = execFile(
        process.execPath,
        [tscJs, '--noEmit', '--project', tsconfigRunPath],
        { cwd: RUNNER_DIR },
        (error, stdout, stderr) => {
          // If error is null, tsc exited 0 (clean).
          // If error is present with a non-zero exit code, diagnostics are in stdout.
          if (error && typeof (error as NodeJS.ErrnoException).code === 'string') {
            // Process-level spawn error (e.g. ENOENT)
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        },
      );

      childProcess.on('error', (err) => {
        reject(err);
      });
    });

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
      timer = setTimeout(() => {
        if (childProcess && !childProcess.killed) {
          try {
            childProcess.kill();
          } catch {
            // Ignore process kill errors
          }
        }
        resolve({ timeout: true });
      }, STATIC_VALIDATION_TIMEOUT_MS);
    });

    const result = await Promise.race([tscExecution, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if ('timeout' in result) {
      return { valid: false, errors: ['Static validation timed out'] };
    }

    const stdoutLines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (stdoutLines.length > 0) {
      return { valid: false, errors: stdoutLines };
    }

    const stderrLines = result.stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (stderrLines.length > 0) {
      return { valid: false, errors: stderrLines };
    }

    return { valid: true, errors: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [message] };
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
  }
}
