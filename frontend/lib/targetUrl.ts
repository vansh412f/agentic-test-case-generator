export type TargetKind = 'public' | 'loopback' | 'private' | 'invalid';

export interface ClassifyResult {
  kind: TargetKind;
  normalized: string | null;
  hostname?: string;
  port?: number;
  isAllInterfaces?: boolean; // true for 0.0.0.0
}

export function getDeploymentMode(): 'hosted' | 'local' {
  const envMode = process.env.NEXT_PUBLIC_DEPLOYMENT_MODE;
  if (envMode === 'hosted' || envMode === 'local') {
    return envMode;
  }
  return process.env.NODE_ENV === 'production' ? 'hosted' : 'local';
}

export function extractTargetPort(raw: string, defaultPort = 3000): number {
  try {
    const trimmed = raw.trim();
    const hasScheme = /^https?:\/\//i.test(trimmed);
    const parsed = new URL(hasScheme ? trimmed : `http://${trimmed}`);
    if (parsed.port) {
      const portNum = Number.parseInt(parsed.port, 10);
      if (!Number.isNaN(portNum) && portNum > 0 && portNum <= 65535) {
        return portNum;
      }
    }
  } catch {
    // Fallback to default
  }
  return defaultPort;
}

export function classifyTarget(raw: string): ClassifyResult {
  if (!raw || typeof raw !== 'string') {
    return { kind: 'invalid', normalized: null };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { kind: 'invalid', normalized: null };
  }

  // Pre-parse check for scheme
  let urlToParse = trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    // If it looks like loopback or private host, default to http://, else https://
    const cleanHostPart = trimmed.split('/')[0] ?? '';
    const hostGuess = cleanHostPart.replace(/^\[/, '').split(']')[0]?.split(':')[0]?.toLowerCase() ?? '';
    if (
      hostGuess === 'localhost' ||
      hostGuess.endsWith('.localhost') ||
      hostGuess === '127.1' ||
      hostGuess.startsWith('127.') ||
      hostGuess === '0.0.0.0' ||
      hostGuess === '::1' ||
      cleanHostPart.startsWith('[::1]') ||
      hostGuess.startsWith('192.168.') ||
      hostGuess.startsWith('10.') ||
      hostGuess.endsWith('.local')
    ) {
      urlToParse = `http://${trimmed}`;
    } else {
      urlToParse = `https://${trimmed}`;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(urlToParse);
  } catch {
    return { kind: 'invalid', normalized: null };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'invalid', normalized: null };
  }

  // Clean hostname: strip IPv6 brackets and trailing dot
  const rawHost = parsed.hostname.toLowerCase();
  const host = rawHost.replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (!host) {
    return { kind: 'invalid', normalized: null };
  }

  const port = parsed.port ? Number.parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);

  // 1. Loopback detection
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '127.1' ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  ) {
    return {
      kind: 'loopback',
      normalized: parsed.toString(),
      hostname: host,
      port,
    };
  }

  // 0.0.0.0 (all interfaces: loopback category but special note)
  if (host === '0.0.0.0') {
    return {
      kind: 'loopback',
      normalized: parsed.toString(),
      hostname: host,
      port,
      isAllInterfaces: true,
    };
  }

  // 2. Private network detection
  if (
    host.endsWith('.local') ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^169\.254\.\d+\.\d+$/.test(host)
  ) {
    return {
      kind: 'private',
      normalized: parsed.toString(),
      hostname: host,
      port,
    };
  }

  // 3. Known tunnel domains or public hostnames
  return {
    kind: 'public',
    normalized: parsed.toString(),
    hostname: host,
    port,
  };
}

export function isTunnelUrl(raw: string): boolean {
  const result = classifyTarget(raw);
  if (result.kind !== 'public' || !result.hostname) return false;
  const host = result.hostname;
  return (
    host.endsWith('.trycloudflare.com') ||
    host.endsWith('.ngrok-free.app') ||
    host.endsWith('.ngrok.io') ||
    host.endsWith('.loca.lt')
  );
}
