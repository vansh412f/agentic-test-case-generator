import { config } from '../config.ts';

// Child processes run LLM-generated code. A target page can prompt-inject that
// code, so the child must never see DATABASE_URL, provider keys or POW_SECRET.
const PASSTHROUGH = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'SystemDrive', 'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'XDG_CACHE_HOME', 'PLAYWRIGHT_BROWSERS_PATH', 'LANG', 'LC_ALL', 'TZ',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY',
] as const;

export function childProcessEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HEADLESS: config.HEADLESS ? 'true' : 'false',
  };
  for (const key of PASSTHROUGH) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

export function playwrightRunnerEnv(resultsPath: string): NodeJS.ProcessEnv {
  return childProcessEnv({
    PLAYWRIGHT_JSON_OUTPUT_FILE: resultsPath,
    HEADLESS: config.HEADLESS ? 'true' : 'false', // explicit, from validated config
    ...(process.env.AGT_EGRESS_PROXY ? { AGT_EGRESS_PROXY: process.env.AGT_EGRESS_PROXY } : {}),
  });
}
// Module component implementation.
