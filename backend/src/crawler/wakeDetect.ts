import { config } from '../config.ts';

export const WAKE_TEXT = /waking|spinning up|starting up|cold start|booting|service unavailable|application (is )?loading/i;
export const TUNNEL_BLOCKED_TEXT = /Invalid Host header|Blocked request\. This host/i;

export interface ClassifyLandingInput {
  host: string;
  status?: number;
  elementCount?: number;
  bodyText?: string;
  timedOut?: boolean;
  suffixes?: string[];
}

export function matchesWakingSuffix(host: string, suffixes: string[]): boolean {
  const cleanHost = host.toLowerCase().trim();
  return suffixes.some((suffix) => {
    const s = suffix.toLowerCase().trim();
    if (!s) return false;
    return cleanHost === s || cleanHost.endsWith(`.${s}`);
  });
}

export function classifyLanding(input: ClassifyLandingInput): 'ok' | 'waking' | 'tunnel_host_blocked' {
  const body = input.bodyText ?? '';
  if (TUNNEL_BLOCKED_TEXT.test(body)) {
    return 'tunnel_host_blocked';
  }

  const suffixes = input.suffixes ?? (config.WAKING_HOST_SUFFIXES ? config.WAKING_HOST_SUFFIXES.split(',').map((s) => s.trim()) : []);
  const hostMatches = matchesWakingSuffix(input.host, suffixes);

  if (hostMatches) {
    const isWakingStatus = input.status !== undefined && [502, 503, 504].includes(input.status);
    const isWakingContent = (input.elementCount ?? 0) <= 2 && WAKE_TEXT.test(body);
    if (input.timedOut || isWakingStatus || isWakingContent) {
      return 'waking';
    }
  }

  return 'ok';
}
// Module component implementation.
