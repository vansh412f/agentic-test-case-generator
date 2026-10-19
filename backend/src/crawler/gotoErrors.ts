import { errors } from 'playwright';
import { CrawlError } from './crawlErrors.ts';
import { classifyLanding } from './wakeDetect.ts';

export function mapGotoError(err: unknown, url: string): CrawlError {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = url;
  }

  const msg = err instanceof Error ? err.message : String(err);

  // 1. DNS failure in Chromium or Node getaddrinfo
  if (msg.includes('ERR_NAME_NOT_RESOLVED') || msg.includes('ENOTFOUND')) {
    return new CrawlError(
      'TARGET_UNREACHABLE',
      `Website not found: could not find ${host}.`,
      err,
      { reason: 'dns_not_found', host, raw: msg },
    );
  }

  if (msg.includes('EAI_AGAIN')) {
    return new CrawlError(
      'TARGET_UNREACHABLE',
      `Could not look up ${host}: temporary DNS failure.`,
      err,
      { reason: 'dns_temporary', host, raw: msg },
    );
  }

  // 2. Connection refused
  if (msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('ECONNREFUSED')) {
    return new CrawlError(
      'TARGET_UNREACHABLE',
      `The website refused the connection at ${host}.`,
      err,
      { reason: 'connection_refused', host, raw: msg },
    );
  }

  // 3. Timeouts (check waking first)
  const isTimeout =
    err instanceof errors.TimeoutError ||
    msg.includes('ERR_CONNECTION_TIMED_OUT') ||
    msg.includes('ERR_TIMED_OUT') ||
    msg.toLowerCase().includes('timeout');

  if (isTimeout) {
    const landing = classifyLanding({ host, timedOut: true });
    if (landing === 'waking') {
      return new CrawlError(
        'TARGET_WAKING',
        `${host} is waking up from sleep.`,
        err,
        { reason: 'waking', host, retryAfterSeconds: 30, raw: msg },
      );
    }
    return new CrawlError(
      'NAVIGATION_TIMEOUT',
      `The website took too long to respond: ${url}.`,
      err,
      { reason: 'connection_timed_out', host, raw: msg },
    );
  }

  // 4. TLS / SSL certificate errors
  if (/ERR_CERT_|ERR_SSL_/.test(msg)) {
    return new CrawlError(
      'TARGET_UNREACHABLE',
      `Secure connection failed: the site's certificate could not be verified for ${host}.`,
      err,
      { reason: 'tls_error', host, raw: msg },
    );
  }

  // 5. Redirect loop
  if (msg.includes('ERR_TOO_MANY_REDIRECTS')) {
    return new CrawlError(
      'TARGET_UNREACHABLE',
      `The page keeps redirecting: ${url}.`,
      err,
      { reason: 'redirect_loop', host, raw: msg },
    );
  }

  // 6. Generic navigation failure
  return new CrawlError(
    'NAVIGATION_FAILED',
    `Failed to navigate to ${url}.`,
    err,
    { reason: 'navigation_failed', host, raw: msg },
  );
}
