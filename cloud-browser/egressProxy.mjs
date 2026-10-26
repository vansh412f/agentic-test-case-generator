import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export const NON_PUBLIC = new BlockList();

for (const [netAddr, prefix] of [
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
]) {
  NON_PUBLIC.addSubnet(netAddr, prefix, 'ipv4');
}

for (const [netAddr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  NON_PUBLIC.addSubnet(netAddr, prefix, 'ipv6');
}

// Explicit cloud metadata blocks
NON_PUBLIC.addAddress('169.254.169.254', 'ipv4');
NON_PUBLIC.addAddress('fd00:ec2::254', 'ipv6');

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 0) return false;
  const mapped = family === 6 ? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1] : undefined;
  if (mapped) return !NON_PUBLIC.check(mapped, 'ipv4');
  return !NON_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

let proxyServer = null;
let proxyPort = 0;
let blockedCount = 0;

export function getBlockedCount() {
  return blockedCount;
}

export function resetBlockedCount() {
  blockedCount = 0;
}

function isPortAllowed(port) {
  if (port === proxyPort) return false;
  return port === 80 || port === 443 || (port >= 1024 && port <= 65535);
}

function parseHostAndPort(rawUrl, defaultPort = 80) {
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

function isDisallowedHostname(host) {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  );
}

async function resolveAddresses(host) {
  if (isDisallowedHostname(host)) {
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

function orderAddressesIpv4First(addresses) {
  const v4 = [];
  const v6 = [];
  for (const addr of addresses) {
    if (isIP(addr) === 4) {
      v4.push(addr);
    } else {
      v6.push(addr);
    }
  }
  return [...v4, ...v6];
}

const RETRYABLE_CONNECT_ERRORS = new Set(['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT']);

async function handleConnect(req, clientSocket, head) {
  if (typeof clientSocket.setTimeout === 'function') {
    clientSocket.setTimeout(60_000, () => clientSocket.destroy());
  }

  const parsed = parseHostAndPort(req.url ?? '', 443);
  if (!parsed || !isPortAllowed(parsed.port) || isDisallowedHostname(parsed.host)) {
    blockedCount++;
    console.warn(`[Egress] blocked ${parsed?.host ?? 'unknown'} → disallowed host/port`);
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
  let activeUpstream = null;

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

    upstream.once('error', (err) => {
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

async function handleHttpRequest(req, res) {
  req.setTimeout(60_000, () => req.destroy());
  res.setTimeout(60_000, () => res.destroy());

  let targetUrl;
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

  if (!isPortAllowed(port) || isDisallowedHostname(host)) {
    blockedCount++;
    console.warn(`[Egress] blocked ${host} → disallowed host/port`);
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
  const MAX_BODY_BYTES = 10 * 1024 * 1024;
  const chunks = [];
  let bodySize = 0;
  let payloadTooLarge = false;

  req.on('data', (chunk) => {
    if (payloadTooLarge) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bodySize += buf.length;
    if (bodySize > MAX_BODY_BYTES) {
      payloadTooLarge = true;
      req.destroy();
      if (!res.headersSent) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload Too Large');
      }
    } else {
      chunks.push(buf);
    }
  });

  req.on('end', () => {
    if (payloadTooLarge) return;
    const bodyBuffer = Buffer.concat(chunks);
    let index = 0;
    let responded = false;

    const tryForward = () => {
      if (index >= targetIps.length) {
        if (!responded && !res.headersSent) {
          res.writeHead(502);
          res.end('Bad Gateway');
        }
        return;
      }

      const targetIp = targetIps[index++];
      const forwardHeaders = { ...req.headers };
      delete forwardHeaders['host'];
      delete forwardHeaders['proxy-connection'];

      const options = {
        hostname: targetIp,
        port: port,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: {
          ...forwardHeaders,
          host: req.headers.host || `${host}:${port}`,
        },
        family: isIP(targetIp),
      };

      let connected = false;
      let socketRef = null;
      let initialBytesWritten = 0;

      const forwardReq = http.request(options, (forwardRes) => {
        responded = true;
        res.writeHead(forwardRes.statusCode ?? 502, forwardRes.headers);
        forwardRes.pipe(res);
      });

      const timer = setTimeout(() => {
        if (!connected) {
          forwardReq.destroy(Object.assign(new Error('Connect timeout'), { code: 'ETIMEDOUT' }));
        }
      }, 5_000);

      forwardReq.on('socket', (socket) => {
        socketRef = socket;
        initialBytesWritten = socket.bytesWritten;
        if (socket.connecting === false) {
          connected = true;
          clearTimeout(timer);
          forwardReq.setTimeout(60_000, () => forwardReq.destroy());
        } else {
          socket.once('connect', () => {
            connected = true;
            clearTimeout(timer);
            forwardReq.setTimeout(60_000, () => forwardReq.destroy());
          });
        }
      });

      forwardReq.on('error', (err) => {
        clearTimeout(timer);
        forwardReq.destroy();
        if (!responded) {
          const bytesWritten = socketRef ? socketRef.bytesWritten > initialBytesWritten : false;
          if (RETRYABLE_CONNECT_ERRORS.has(err?.code) && !bytesWritten && index < targetIps.length) {
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

export async function startEgressProxy() {
  if (proxyServer && proxyPort > 0) {
    return `http://127.0.0.1:${proxyPort}`;
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handleHttpRequest(req, res).catch((err) => {
        console.error('[EgressProxy] http error:', err);
        if (!res.headersSent) res.writeHead(500);
        res.end('Internal Proxy Error');
      });
    });

    server.on('connect', (req, clientSocket, head) => {
      handleConnect(req, clientSocket, head).catch((err) => {
        console.error('[EgressProxy] connect error:', err);
        clientSocket.write('HTTP/1.1 500 Internal Error\r\n\r\n');
        clientSocket.destroy();
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        proxyPort = addr.port;
        proxyServer = server;
        resolve(`http://127.0.0.1:${proxyPort}`);
      } else {
        reject(new Error('Failed to obtain egress proxy address'));
      }
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

export async function stopEgressProxy() {
  if (proxyServer) {
    await new Promise((resolve) => proxyServer.close(() => resolve()));
    proxyServer = null;
    proxyPort = 0;
  }
}
