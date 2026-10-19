import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config.ts';
import { isPublicAddress } from './netPolicy.ts';

let proxyServer: http.Server | null = null;
let proxyPort = 0;
let blockedCount = 0;
let startPromise: Promise<string | null> | null = null;

export function getBlockedCount(): number {
  return blockedCount;
}

export function resetBlockedCount(): void {
  blockedCount = 0;
}

export function getEgressProxyPort(): number {
  return proxyPort;
}

function isPortAllowed(port: number): boolean {
  if (port === proxyPort) return false;
  return port === 80 || port === 443 || (port >= 1024 && port <= 65535);
}

function parseHostAndPort(rawUrl: string, defaultPort = 80): { host: string; port: number } | null {
  try {
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      const u = new URL(rawUrl);
      return {
        host: u.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
        port: parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10),
      };
    }
    const lastColon = rawUrl.lastIndexOf(':');
    if (lastColon === -1) {
      return { host: rawUrl.replace(/^\[|\]$/g, '').toLowerCase(), port: defaultPort };
    }
    const host = rawUrl.slice(0, lastColon).replace(/^\[|\]$/g, '').toLowerCase();
    const port = parseInt(rawUrl.slice(lastColon + 1), 10);
    if (isNaN(port)) return null;
    return { host, port };
  } catch {
    return null;
  }
}

export type DnsResolver = (host: string) => Promise<string[] | null>;
let customDnsResolver: DnsResolver | null = null;

export function setDnsResolverForTest(resolver: DnsResolver | null): void {
  customDnsResolver = resolver;
}

export function orderAddressesIpv4First(addresses: string[]): string[] {
  const v4: string[] = [];
  const v6: string[] = [];
  for (const addr of addresses) {
    if (isIP(addr) === 4) {
      v4.push(addr);
    } else {
      v6.push(addr);
    }
  }
  return [...v4, ...v6];
}

async function resolveAddresses(host: string): Promise<string[] | null> {
  if (customDnsResolver) {
    return customDnsResolver(host);
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return ['127.0.0.1'];
  }
  if (isIP(host) !== 0) {
    return [host];
  }
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    return addrs.map((a) => a.address);
  } catch {
    return null;
  }
}

import type { Duplex } from 'node:stream';

const RETRYABLE_CONNECT_ERRORS = new Set(['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT']);

async function handleConnect(
  req: http.IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
): Promise<void> {
  if ('setTimeout' in clientSocket && typeof (clientSocket as net.Socket).setTimeout === 'function') {
    (clientSocket as net.Socket).setTimeout(60_000, () => clientSocket.destroy());
  }

  const parsed = parseHostAndPort(req.url ?? '', 443);
  if (!parsed || !isPortAllowed(parsed.port)) {
    blockedCount++;
    console.warn(`[Egress] blocked ${parsed?.host ?? 'unknown'} → disallowed-port`);
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  const addresses = await resolveAddresses(parsed.host);
  if (!addresses || addresses.length === 0) {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  const badIp = addresses.find((addr) => !isPublicAddress(addr));
  if (badIp) {
    blockedCount++;
    console.warn(`[Egress] blocked ${parsed.host} → ${badIp}`);
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  const targetIps = orderAddressesIpv4First(addresses);
  let index = 0;
  let activeUpstream: net.Socket | null = null;

  const tryConnect = () => {
    if (index >= targetIps.length) {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.destroy();
      return;
    }
    const targetIp = targetIps[index++];
    let connected = false;

    const upstream = net.connect({
      host: targetIp,
      port: parsed.port,
      family: isIP(targetIp),
    });
    activeUpstream = upstream;

    const timer = setTimeout(() => {
      if (!connected) {
        upstream.destroy(Object.assign(new Error('Connect timeout'), { code: 'ETIMEDOUT' }));
      }
    }, 5_000);

    upstream.once('connect', () => {
      connected = true;
      clearTimeout(timer);
      upstream.setTimeout(60_000, () => upstream.destroy());
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length > 0) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });

    upstream.once('error', (err: any) => {
      clearTimeout(timer);
      upstream.destroy();
      if (!connected) {
        if (RETRYABLE_CONNECT_ERRORS.has(err?.code) && index < targetIps.length) {
          tryConnect();
          return;
        }
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        clientSocket.destroy();
      }
    });
  };

  clientSocket.once('error', () => {
    activeUpstream?.destroy();
  });

  tryConnect();
}

async function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  req.setTimeout(60_000, () => req.destroy());
  res.setTimeout(60_000, () => res.destroy());

  let targetUrl: URL;
  try {
    targetUrl = new URL(
      req.url?.startsWith('http://') || req.url?.startsWith('https://')
        ? req.url
        : `http://${req.headers.host}${req.url}`,
    );
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  const host = targetUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = parseInt(targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80'), 10);

  if (!isPortAllowed(port)) {
    blockedCount++;
    console.warn(`[Egress] blocked ${host} → disallowed-port`);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const addresses = await resolveAddresses(host);
  if (!addresses || addresses.length === 0) {
    res.writeHead(502);
    res.end('Bad Gateway');
    return;
  }

  const badIp = addresses.find((addr) => !isPublicAddress(addr));
  if (badIp) {
    blockedCount++;
    console.warn(`[Egress] blocked ${host} → ${badIp}`);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const targetIps = orderAddressesIpv4First(addresses);
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  req.on('end', () => {
    const bodyBuffer = Buffer.concat(chunks);
    let index = 0;

    const tryForward = () => {
      if (index >= targetIps.length) {
        if (!res.headersSent) res.writeHead(502);
        res.end('Bad Gateway');
        return;
      }
      const targetIp = targetIps[index++];
      let connected = false;
      let responded = false;

      const forwardReq = http.request(
        {
          host: targetIp,
          port,
          method: req.method,
          path: targetUrl.pathname + targetUrl.search,
          headers: {
            ...req.headers,
            host: req.headers.host || targetUrl.host,
          },
          family: isIP(targetIp),
        },
        (forwardRes) => {
          responded = true;
          res.writeHead(forwardRes.statusCode ?? 502, forwardRes.headers);
          forwardRes.pipe(res);
        },
      );

      const timer = setTimeout(() => {
        if (!connected && !responded) {
          forwardReq.destroy(Object.assign(new Error('Connect timeout'), { code: 'ETIMEDOUT' }));
        }
      }, 5_000);

      forwardReq.on('socket', (socket) => {
        socket.once('connect', () => {
          connected = true;
          clearTimeout(timer);
          forwardReq.setTimeout(60_000, () => forwardReq.destroy());
        });
      });

      forwardReq.on('error', (err: any) => {
        clearTimeout(timer);
        forwardReq.destroy();
        if (!responded) {
          if (RETRYABLE_CONNECT_ERRORS.has(err?.code) && index < targetIps.length) {
            tryForward();
            return;
          }
          if (!res.headersSent) res.writeHead(502);
          res.end('Bad Gateway');
        }
      });

      if (bodyBuffer.length > 0) {
        forwardReq.write(bodyBuffer);
      }
      forwardReq.end();
    };

    tryForward();
  });
}

export async function ensureEgressProxy(): Promise<string | null> {
  if (config.LOCAL_AGENT_MODE) return null;
  if (proxyServer && proxyPort > 0) {
    return `http://127.0.0.1:${proxyPort}`;
  }
  if (startPromise) return startPromise;

  startPromise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handleHttpRequest(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end('Internal Proxy Error');
      });
    });

    server.on('connect', (req, clientSocket, head) => {
      handleConnect(req, clientSocket, head).catch(() => {
        clientSocket.write('HTTP/1.1 500 Internal Error\r\n\r\n');
        clientSocket.destroy();
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        proxyPort = addr.port;
        proxyServer = server;
        const proxyUrl = `http://127.0.0.1:${proxyPort}`;
        process.env.AGT_EGRESS_PROXY = proxyUrl;
        resolve(proxyUrl);
      } else {
        reject(new Error('Failed to obtain egress proxy address'));
      }
    });

    server.on('error', (err) => {
      reject(err);
    });
  });

  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

export async function stopEgressProxy(): Promise<void> {
  if (proxyServer) {
    await new Promise<void>((resolve) => proxyServer!.close(() => resolve()));
    proxyServer = null;
    proxyPort = 0;
    delete process.env.AGT_EGRESS_PROXY;
  }
}
