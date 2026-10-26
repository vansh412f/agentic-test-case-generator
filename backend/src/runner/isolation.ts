import { execFile } from 'node:child_process';
import { config } from '../config.ts';
import { recordServerEvent } from '../observability/serverEvents.ts';

let selfCheckPassed = config.RUNNER_ISOLATION !== 'uid';

export function isSelfCheckPassed(): boolean {
  return selfCheckPassed;
}

export function setSelfCheckPassedForTest(passed: boolean): void {
  selfCheckPassed = passed;
}

export function buildRunnerArgv(
  cmd: string,
  args: string[],
): { file: string; args: string[] } {
  if (config.RUNNER_ISOLATION !== 'uid') {
    return { file: cmd, args };
  }
  return {
    file: '/usr/bin/setpriv',
    args: [
      '--reuid',
      String(config.RUNNER_UID),
      '--regid',
      String(config.RUNNER_GID),
      '--groups',
      String(config.RUNNER_GID),
      '--inh-caps=-all',
      '--ambient-caps=-all',
      '--bounding-set=-all',
      '--no-new-privs',
      '--pdeathsig=KILL',
      '--',
      cmd,
      ...args,
    ],
  };
}

export async function reapRunner(): Promise<void> {
  if (config.RUNNER_ISOLATION !== 'uid') {
    return;
  }
  const shCommand = [
    'kill -KILL -1 2>/dev/null;',
    'i=0; while [ "$i" -lt 20 ]; do',
    '  alive=0;',
    '  for d in /proc/[0-9]*; do',
    '    p=${d#/proc/};',
    '    [ "$p" = "$$" ] && continue;',
    '    if kill -0 "$p" 2>/dev/null; then alive=1; break; fi;',
    '  done;',
    '  [ "$alive" -eq 0 ] && break;',
    '  sleep 0.1;',
    '  i=$((i + 1));',
    'done;',
    `find /tmp -xdev -mindepth 1 -user ${config.RUNNER_UID} -delete 2>/dev/null;`,
    'true',
  ].join(' ');
  const { file, args } = buildRunnerArgv('/bin/sh', ['-c', shCommand]);
  await new Promise<void>((resolve) => {
    execFile(file, args, { timeout: 5_000 }, () => {
      resolve();
    });
  });
}

export async function selfCheck(): Promise<boolean> {
  if (config.RUNNER_ISOLATION !== 'uid') {
    selfCheckPassed = true;
    return true;
  }

  try {
    // 1. run `id -u` through buildRunnerArgv, expect RUNNER_UID
    const idCheck = await new Promise<string>((resolve, reject) => {
      const { file, args } = buildRunnerArgv('/usr/bin/id', ['-u']);
      execFile(file, args, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim());
      });
    });

    if (idCheck !== String(config.RUNNER_UID)) {
      throw new Error(`Expected runner UID ${config.RUNNER_UID}, got ${idCheck}`);
    }

    // 2. run `cat /proc/<process.pid>/environ` and `cat /proc/1/environ` through it, expect non-zero exit for both
    const catPidFailed = await new Promise<boolean>((resolve) => {
      const { file, args } = buildRunnerArgv('/bin/cat', [`/proc/${process.pid}/environ`]);
      execFile(file, args, (err) => {
        resolve(Boolean(err));
      });
    });

    if (!catPidFailed) {
      throw new Error(`cat /proc/${process.pid}/environ unexpectedly succeeded`);
    }

    const cat1Failed = await new Promise<boolean>((resolve) => {
      const { file, args } = buildRunnerArgv('/bin/cat', ['/proc/1/environ']);
      execFile(file, args, (err) => {
        resolve(Boolean(err));
      });
    });

    if (!cat1Failed) {
      throw new Error('cat /proc/1/environ unexpectedly succeeded');
    }

    selfCheckPassed = true;
    console.log(
      `[RunnerIsolation] uid isolation verified: runner UID ${config.RUNNER_UID} confirmed, /proc environ unreadable.`,
    );
    return true;
  } catch (err) {
    selfCheckPassed = false;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[RunnerIsolation] runner isolation self-check failed: ${msg}`);
    recordServerEvent('error', 'runner.isolation', { error: msg, uid: config.RUNNER_UID });
    return false;
  }
}

let isolationMutexChain: Promise<unknown> = Promise.resolve();

export async function withRunnerIsolationLock<T>(fn: () => Promise<T>): Promise<T> {
  if (config.RUNNER_ISOLATION !== 'uid') {
    return fn();
  }
  const next = isolationMutexChain.then(async () => {
    return await fn();
  });
  isolationMutexChain = next.catch(() => {});
  return next;
}
