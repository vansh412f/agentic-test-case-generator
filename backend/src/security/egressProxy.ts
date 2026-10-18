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

async function resolveAddresses(host: string): Promise<string[] | null> {
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

  const targetIp = addresses[0];
  const upstream = net.connect({
    host: targetIp,
    port: parsed.port,
    family: isIP(targetIp),
  });

  upstream.setTimeout(60_000, () => upstream.destroy());

  upstream.on('connect', () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length > 0) upstream.write(head);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });

  upstream.on('error', () => {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.destroy();
  });

  clientSocket.on('error', () => {
    upstream.destroy();
  });
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

  const targetIp = addresses[0];
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
      timeout: 60_000,
    },
    (forwardRes) => {
      res.writeHead(forwardRes.statusCode ?? 502, forwardRes.headers);
      forwardRes.pipe(res);
    },
  );

  forwardReq.on('timeout', () => forwardReq.destroy());
  forwardReq.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(forwardReq);
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
