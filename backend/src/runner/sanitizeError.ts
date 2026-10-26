// Strips ANSI color/control codes and cleans up absolute runner paths in test error messages

const ANSI_REGEX =
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

// Matches absolute paths up to and including playwright-runner[/\\]tests[/\\](run-[^/\\]+|capture-[^/\\]+)[/\\]
const RUNNER_PATH_REGEX =
  /(?:[A-Za-z]:\\[^:\n\r]+?|[^\s:\n\r]+?)[/\\]playwright-runner[/\\]tests[/\\](?:run-[^/\\]+|capture-[^/\\]+)[/\\]/gi;

export function sanitizeError(raw: string | null | undefined): string {
  if (!raw) return '';

  let sanitized = raw.replace(ANSI_REGEX, '');

  // Strip runner directory paths to keep just the bare filename, e.g. tc-1.spec.ts:7:79
  sanitized = sanitized.replace(RUNNER_PATH_REGEX, '');

  // Scrub any ?token= query parameter
  sanitized = sanitized.replace(/([?&]token=)[^&\s"'`<>]+/gi, '$1[REDACTED]');

  // Scrub raw BROWSER_WS_TOKEN if present in process.env (without importing config.ts)
  const wsToken = process.env.BROWSER_WS_TOKEN?.trim();
  if (wsToken && wsToken.length >= 4) {
    sanitized = sanitized.split(wsToken).join('[REDACTED]');
    sanitized = sanitized.split(encodeURIComponent(wsToken)).join('[REDACTED]');
  }

  return sanitized;
}
