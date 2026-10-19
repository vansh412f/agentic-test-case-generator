export interface PresentedError {
  title: string;
  body: string;
  hint?: string;
  raw?: string;
}

function isLoopback(host?: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase().trim();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '127.0.0.1' ||
    h.startsWith('127.') ||
    h === '::1' ||
    h === '[::1]' ||
    h === '0.0.0.0'
  );
}

function formatLocalResetTime(iso?: string): string {
  if (!iso) return 'midnight UTC';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function presentError(
  code: string,
  details?: unknown,
  rawMessage?: string,
): PresentedError {
  const d = (details && typeof details === 'object' ? details : {}) as Record<string, unknown>;
  const reason = (d.reason as string) ?? '';
  const host = (d.host as string) ?? 'this address';
  const raw = (d.raw as string) ?? rawMessage;

  // 1. Specific crawl / network reasons
  if (reason === 'dns_not_found') {
    return {
      title: 'Website not found',
      body: `We couldn't find ${host}. Check the spelling of the address.`,
      raw,
    };
  }

  if (reason === 'dns_temporary') {
    return {
      title: `Couldn't look up ${host}`,
      body: 'The address lookup failed temporarily. Try again in a moment.',
      raw,
    };
  }

  if (reason === 'connection_refused') {
    const hint = isLoopback(host) ? 'Make sure your app is running on that port.' : undefined;
    return {
      title: 'The website refused the connection',
      body: `Nothing is accepting connections at ${host}.`,
      hint,
      raw,
    };
  }

  if (reason === 'private_address' || reason === 'blocked_host') {
    return {
      title: 'This address is on a private network',
      body: 'Hosted mode tests public websites only.',
      hint: 'Use a tunnel URL, or run the project in local mode.',
      raw,
    };
  }

  if (reason === 'tls_error') {
    return {
      title: 'Secure connection failed',
      body: "The site's certificate could not be verified.",
      raw,
    };
  }

  if (reason === 'redirect_loop') {
    return {
      title: 'The page keeps redirecting',
      body: 'The target website entered an infinite redirect loop.',
      raw,
    };
  }

  // 2. High-level error codes
  switch (code) {
    case 'TARGET_UNREACHABLE':
      return {
        title: 'Target unreachable',
        body: `We couldn't connect to ${host}. Check the network status or address.`,
        raw,
      };

    case 'NAVIGATION_TIMEOUT':
      return {
        title: 'The website took too long to respond',
        body: 'The page did not finish loading within the timeout limit.',
        hint: 'Check if the website is active and responds quickly.',
        raw,
      };

    case 'INVALID_URL':
      return {
        title: "That doesn't look like a web address",
        body: 'Please provide a valid web address starting with http:// or https://.',
        raw,
      };

    case 'TARGET_NOT_ALLOWED':
      return {
        title: 'Target not permitted',
        body: 'The specified address is restricted.',
        hint: 'Use a tunnel URL, or run the project in local mode.',
        raw,
      };

    case 'TARGET_WAKING':
      return {
        title: `${host} is waking up`,
        body: 'The server was asleep and is spinning up. Retrying automatically...',
        hint: 'Free-tier hosting platforms often sleep after periods of inactivity.',
        raw,
      };

    case 'TUNNEL_HOST_BLOCKED':
      return {
        title: 'Tunnel host blocked',
        body: `The dev server at ${host} rejected requests from this tunnel host.`,
        hint: 'Allow the tunnel host in your dev server config (e.g. allowedHosts in Vite/Webpack).',
        raw,
      };

    case 'RATE_LIMITED': {
      const resetsAt = d.resetsAt as string | undefined;
      const localTime = formatLocalResetTime(resetsAt);
      return {
        title: 'Daily limit reached',
        body: `You have reached the maximum daily requests. Limit resets at ${localTime}.`,
        raw,
      };
    }

    case 'DAILY_QUOTA_EXHAUSTED': {
      const scope = d.scope as string | undefined;
      const limit = typeof d.limit === 'number' ? d.limit : 8;
      const resetsAt = d.resetsAt as string | undefined;
      const localTime = formatLocalResetTime(resetsAt);
      let bodyPrefix = "Today's free demo capacity is used up.";
      if (scope === 'visitor') {
        bodyPrefix = `You've used all ${limit} free runs for today.`;
      } else if (scope === 'ip') {
        bodyPrefix = `This network has used all ${limit} free runs for today.`;
      }
      return {
        title: 'Daily quota exhausted',
        body: `${bodyPrefix} Resets at ${localTime}.`,
        hint: 'Add your own free Groq or Gemini key in API Keys for unlimited runs.',
        raw,
      };
    }

    case 'ALREADY_RUNNING':
      return {
        title: 'Run in progress',
        body: 'You already have an active or queued run in progress.',
        hint: 'Wait for your current test generation to finish before starting another.',
        raw,
      };

    case 'QUEUE_FULL':
      return {
        title: 'Server busy',
        body: 'The execution queue is currently full. Please retry in a few moments.',
        raw,
      };

    case 'POW_FAILED':
      return {
        title: 'Bot verification failed',
        body: 'Proof-of-work challenge could not be verified. Please retry.',
        raw,
      };

    case 'INVALID_API_KEY': {
      const provider = (d.provider as string) ?? 'API';
      return {
        title: 'Invalid API key',
        body: `Your ${provider} key was rejected by the provider.`,
        hint: 'Open API Keys settings to update or remove your key.',
        raw,
      };
    }

    case 'TOO_MANY_URLS': {
      const max = d.max ?? 3;
      return {
        title: 'Too many pages selected',
        body: `A single run may contain at most ${max} pages.`,
        raw,
      };
    }

    case 'BROWSER_LAUNCH_FAILED':
    case 'UPSTREAM_UNAVAILABLE':
      return {
        title: 'Service temporarily unavailable',
        body: rawMessage || 'The crawler browser could not start. Please retry shortly.',
        raw,
      };

    case 'RUNNER_UNAVAILABLE':
      return {
        title: 'Test runner unavailable',
        body: 'Test execution is temporarily unavailable. Try again later.',
        raw,
      };

    default:
      return {
        title: 'Request failed',
        body: rawMessage || 'An unexpected error occurred.',
        raw,
      };
  }
}
