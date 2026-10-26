import { config } from '../config.ts';

/**
 * Returns true if remote browser execution is active.
 * When LOCAL_AGENT_MODE=true, local Chromium is always used so local dev & loopback targets work.
 * When LOCAL_AGENT_MODE=false and BROWSER_WS_ENDPOINT is non-empty, all browser sessions
 * (crawl, observe, runner) route to the remote Playwright WebSocket endpoint with zero local fallback.
 */
export function isRemoteBrowserActive(): boolean {
  return Boolean(
    !config.LOCAL_AGENT_MODE &&
      config.BROWSER_WS_ENDPOINT &&
      config.BROWSER_WS_ENDPOINT.trim().length > 0,
  );
}

/**
 * Builds the fully-authenticated WebSocket URL containing the token query parameter if configured.
 */
export function buildAuthenticatedBrowserWsUrl(): string {
  if (!config.BROWSER_WS_ENDPOINT) {
    throw new Error('BROWSER_WS_ENDPOINT is not configured');
  }
  const u = new URL(config.BROWSER_WS_ENDPOINT.trim());
  if (config.BROWSER_WS_TOKEN && config.BROWSER_WS_TOKEN.trim().length > 0) {
    u.searchParams.set('token', config.BROWSER_WS_TOKEN.trim());
  }
  return u.toString();
}

/**
 * Returns the host:port allow spec for netGuard.mjs when remote browser is active, or null otherwise.
 * E.g. "https://example.com/pw" -> "example.com:443", "ws://127.0.0.1:9222/ws" -> "127.0.0.1:9222"
 */
export function getRemoteBrowserAllowSpec(): string | null {
  if (!isRemoteBrowserActive()) {
    return null;
  }
  const u = new URL(config.BROWSER_WS_ENDPOINT!.trim());
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = u.port
    ? parseInt(u.port, 10)
    : u.protocol === 'wss:' || u.protocol === 'https:'
      ? 443
      : 80;
  return `${host}:${port}`;
}

/**
 * Redacts any credentials or tokens from the endpoint URL for logging.
 * Strips all query parameters and appends ?token=[REDACTED] if token is set.
 */
export function getRedactedBrowserEndpoint(): string | null {
  if (!config.BROWSER_WS_ENDPOINT || config.BROWSER_WS_ENDPOINT.trim().length === 0) {
    return null;
  }
  try {
    const u = new URL(config.BROWSER_WS_ENDPOINT.trim());
    const hasToken = Boolean(config.BROWSER_WS_TOKEN && config.BROWSER_WS_TOKEN.trim().length > 0);
    return `${u.protocol}//${u.host}${u.pathname}${hasToken ? '?token=[REDACTED]' : ''}`;
  } catch {
    return '[INVALID_ENDPOINT]';
  }
}

/**
 * Scrubs ?token= query parameter values and raw token occurrences from input text.
 */
export function scrubBrowserWsSecrets(input: string): string {
  if (!input) return '';
  let res = input.replace(/([?&]token=)[^&\s"'`<>]+/gi, '$1[REDACTED]');
  const token = config.BROWSER_WS_TOKEN?.trim();
  if (token && token.length >= 4) {
    res = res.split(token).join('[REDACTED]');
    res = res.split(encodeURIComponent(token)).join('[REDACTED]');
  }
  return res;
}
