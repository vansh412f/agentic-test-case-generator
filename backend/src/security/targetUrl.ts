import { CrawlError } from '../crawler/crawlErrors.ts';

const PRIVATE_OR_LOOPBACK_HOST_REGEX =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0|\[::1\]|::1)(:\d+)?$/i;

export function isPrivateOrLoopbackHost(host: string): boolean {
  const clean = host.toLowerCase().trim();
  if (PRIVATE_OR_LOOPBACK_HOST_REGEX.test(clean)) return true;
  if (clean.endsWith('.localhost') || clean.endsWith('.local') || clean.endsWith('.internal') || clean.endsWith('.lan')) {
    return true;
  }
  return false;
}

export interface NormalizeTargetUrlOptions {
  localMode?: boolean;
}

export function normalizeTargetUrl(
  raw: string,
  options: NormalizeTargetUrlOptions = {},
): string {
  if (typeof raw !== 'string') {
    throw new CrawlError('INVALID_URL', 'URL must be a string', undefined, { reason: 'invalid_format' });
  }

  let trimmed = raw.trim();
  if (!trimmed) {
    throw new CrawlError('INVALID_URL', 'URL cannot be empty', undefined, { reason: 'empty_host' });
  }

  // Detect whether a scheme is present
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(\/\/)?/);
  const isPortFollow = schemeMatch && !schemeMatch[2] && /^([a-zA-Z0-9.-]+):(\d+)([\/?#]|$)/.test(trimmed);

  if (!schemeMatch || isPortFollow) {
    // No scheme provided
    const hostPart = trimmed.split(/[/?#]/)[0];
    if (isPrivateOrLoopbackHost(hostPart) || (options.localMode && !hostPart.includes('.'))) {
      trimmed = `http://${trimmed}`;
    } else {
      trimmed = `https://${trimmed}`;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new CrawlError('INVALID_URL', 'Invalid URL format', err, { reason: 'invalid_format' });
  }

  // Scheme must be http: or https:
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CrawlError('INVALID_URL', 'Only HTTP and HTTPS URLs are supported', undefined, {
      reason: 'unsupported_scheme',
      scheme: parsed.protocol.replace(':', ''),
    });
  }

  // Reject credentials in the URL
  if (parsed.username || parsed.password) {
    throw new CrawlError('INVALID_URL', 'URLs with credentials are not permitted', undefined, {
      reason: 'credentials',
    });
  }

  // Reject empty hosts
  if (!parsed.hostname || parsed.hostname.trim() === '') {
    throw new CrawlError('INVALID_URL', 'URL host cannot be empty', undefined, { reason: 'empty_host' });
  }

  return parsed.toString();
}
