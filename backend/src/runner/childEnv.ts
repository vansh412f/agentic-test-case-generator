import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NET_GUARD_PATH = path.resolve(__dirname, '../../playwright-runner/netGuard.mjs');
const NET_GUARD_URL = pathToFileURL(NET_GUARD_PATH).href;

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
  const extra: Record<string, string> = {
    PLAYWRIGHT_JSON_OUTPUT_FILE: resultsPath,
    HEADLESS: config.HEADLESS ? 'true' : 'false', // explicit, from validated config
  };

  if (!config.LOCAL_AGENT_MODE && process.env.AGT_EGRESS_PROXY) {
    extra.AGT_EGRESS_PROXY = process.env.AGT_EGRESS_PROXY;
    const existingNodeOptions = process.env.NODE_OPTIONS?.trim() ?? '';
    extra.NODE_OPTIONS = existingNodeOptions
      ? `${existingNodeOptions} --import=${NET_GUARD_URL}`
      : `--import=${NET_GUARD_URL}`;
  }

  return childProcessEnv(extra);
}
