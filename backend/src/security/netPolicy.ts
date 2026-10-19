import { BlockList, isIP } from 'node:net';
import dns from 'node:dns/promises';
import { config } from '../config.ts';
import { CrawlError } from '../crawler/crawlErrors.ts';

export const NON_PUBLIC = new BlockList();

for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv4');
}

for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv6');
}

// Explicit cloud metadata blocks
NON_PUBLIC.addAddress('169.254.169.254', 'ipv4');
NON_PUBLIC.addAddress('fd00:ec2::254', 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  const mapped = family === 6 ? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1] : undefined;
  if (mapped) return !NON_PUBLIC.check(mapped, 'ipv4');
  return !NON_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export type DnsLookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultDnsLookup: DnsLookupFn = async (hostname) => {
  return dns.lookup(hostname, { all: true, verbatim: true });
};

export async function assertPublicTarget(
  urlStr: string,
  lookupFn: DnsLookupFn = defaultDnsLookup,
): Promise<void> {
  if (config.LOCAL_AGENT_MODE) return;

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new CrawlError('TARGET_NOT_ALLOWED', `Cannot parse URL: "${urlStr}".`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CrawlError('TARGET_NOT_ALLOWED', `Unsupported protocol "${url.protocol}". Only http and https are allowed.`);
  }

  if (url.username || url.password) {
    throw new CrawlError('TARGET_NOT_ALLOWED', 'Target URL must not contain credentials.', undefined, {
      reason: 'credentials',
    });
  }

  const rawHost = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    rawHost === 'localhost' ||
    rawHost.endsWith('.localhost') ||
    rawHost.endsWith('.local') ||
    rawHost.endsWith('.internal')
  ) {
    throw new CrawlError('TARGET_NOT_ALLOWED', `Target host "${rawHost}" is not allowed.`, undefined, {
      reason: 'blocked_host',
      host: rawHost,
    });
  }

  if (isIP(rawHost) !== 0) {
    if (!isPublicAddress(rawHost)) {
      throw new CrawlError('TARGET_NOT_ALLOWED', `Target IP "${rawHost}" is not a public address.`, undefined, {
        reason: 'private_address',
        host: rawHost,
      });
    }
    return;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupFn(rawHost);
  } catch (err: any) {
    const code = err?.code;
    if (code === 'ENOTFOUND') {
      throw new CrawlError('TARGET_UNREACHABLE', `Website not found: could not find ${rawHost}.`, err, {
        reason: 'dns_not_found',
        host: rawHost,
        raw: err?.message,
      });
    }
    if (code === 'EAI_AGAIN' || code === 'ETIMEDOUT') {
      throw new CrawlError('TARGET_UNREACHABLE', `Could not look up ${rawHost}. The address lookup failed temporarily.`, err, {
        reason: 'dns_temporary',
        host: rawHost,
        raw: err?.message,
      });
    }
    throw new CrawlError('TARGET_UNREACHABLE', `Could not resolve host ${rawHost}.`, err, {
      reason: 'dns_not_found',
      host: rawHost,
      raw: err?.message,
    });
  }

  if (!addresses || addresses.length === 0) {
    throw new CrawlError('TARGET_UNREACHABLE', `Website not found: ${rawHost} resolved to no addresses.`, undefined, {
      reason: 'dns_not_found',
      host: rawHost,
    });
  }

  for (const addr of addresses) {
    if (!isPublicAddress(addr.address)) {
      throw new CrawlError('TARGET_NOT_ALLOWED', `This address is on a private network: ${rawHost}.`, undefined, {
        reason: 'private_address',
        host: rawHost,
      });
    }
  }
}
