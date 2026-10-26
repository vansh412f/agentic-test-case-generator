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
    MALLOC_ARENA_MAX: '2',
    UV_THREADPOOL_SIZE: '2',
  };
  for (const key of PASSTHROUGH) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}

import {
  isRemoteBrowserActive,
  buildAuthenticatedBrowserWsUrl,
  getRemoteBrowserAllowSpec,
} from '../browser/remoteBrowser.ts';

export function playwrightRunnerEnv(
  resultsPath: string,
  extraEnv: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const existingNodeOptions = process.env.NODE_OPTIONS?.trim() ?? '';
  const withHeapCap = existingNodeOptions.includes('--max-old-space-size')
    ? existingNodeOptions
    : [existingNodeOptions, '--max-old-space-size=112'].filter(Boolean).join(' ');

  const extra: Record<string, string> = {
    PLAYWRIGHT_JSON_OUTPUT_FILE: resultsPath,
    HEADLESS: config.HEADLESS ? 'true' : 'false', // explicit, from validated config
    RUNNER_TIMEOUT_SCALE: String(config.RUNNER_TIMEOUT_SCALE),
    ...extraEnv,
  };

  if (isRemoteBrowserActive()) {
    extra.AGT_BROWSER_WS_ENDPOINT = buildAuthenticatedBrowserWsUrl();
    const allow = getRemoteBrowserAllowSpec();
    if (allow) extra.AGT_REMOTE_BROWSER_ALLOW = allow;
    // Do NOT set AGT_EGRESS_PROXY for remote browser
    extra.NODE_OPTIONS = `${withHeapCap} --import=${NET_GUARD_URL}`.trim();
  } else if (!config.LOCAL_AGENT_MODE && process.env.AGT_EGRESS_PROXY) {
    extra.AGT_EGRESS_PROXY = process.env.AGT_EGRESS_PROXY;
    extra.NODE_OPTIONS = `${withHeapCap} --import=${NET_GUARD_URL}`.trim();
  } else {
    extra.NODE_OPTIONS = withHeapCap;
  }

  return childProcessEnv(extra);
}
