import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  const pw = await import('playwright');
  chromium = pw.chromium || pw.default?.chromium;
} catch {
  // Fallback for local smoke test using backend/node_modules
  const pwPath = require.resolve('playwright', { paths: [process.env.NODE_PATH || '', process.cwd()] });
  const pw = await import(pathToFileURL(pwPath).href);
  chromium = pw.chromium || pw.default?.chromium;
}
import { startEgressProxy, stopEgressProxy, getBlockedCount } from './egressProxy.mjs';

const rawToken = process.env.BROWSER_WS_TOKEN?.trim();
if (!rawToken || rawToken.length < 32) {
  console.error('[Fatal] BROWSER_WS_TOKEN missing or < 32 chars');
  process.exit(1);
}

const expectedTokenHash = crypto.createHash('sha256').update(rawToken).digest();
function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const candidateHash = crypto.createHash('sha256').update(token.trim()).digest();
  return crypto.timingSafeEqual(expectedTokenHash, candidateHash);
}

let egressProxyUrl = null;
let activeSessions = 0;
const MAX_CONCURRENT_SESSIONS = 2;
const MAX_SESSION_MS = 285_000;

try {
  egressProxyUrl = await startEgressProxy();
  console.log(`[EgressProxy] listening on ${egressProxyUrl}`);
} catch (err) {
  console.error('[Fatal] Failed to start egress proxy:', err);
  process.exit(1);
}

async function launchIsolatedBrowserServer() {
  return await chromium.launchServer({
    headless: true,
    host: '127.0.0.1',
    chromiumSandbox: false,
    proxy: { server: egressProxyUrl },
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ],
  });
}

let warmBrowserPromise = null;
let isShuttingDown = false;

function ensureWarmBrowser() {
  if (!isShuttingDown && activeSessions < MAX_CONCURRENT_SESSIONS && !warmBrowserPromise) {
    warmBrowserPromise = launchIsolatedBrowserServer().catch((err) => {
      warmBrowserPromise = null;
      console.warn('[WarmPool] pre-warm failed:', err instanceof Error ? err.message : String(err));
      return null;
    });
  }
}

async function acquireBrowserServer() {
  if (warmBrowserPromise) {
    const claimed = warmBrowserPromise;
    warmBrowserPromise = null;
    if (activeSessions < MAX_CONCURRENT_SESSIONS) {
      ensureWarmBrowser();
    }
    const srv = await claimed;
    if (srv) {
      return srv;
    }
  }
  return await launchIsolatedBrowserServer();
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url ?? '/', 'http://localhost');
  if ((reqUrl.pathname === '/healthz' || reqUrl.pathname === '/health') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        playwright: '1.63.0',
        activeSessions,
        blockedEgress: getBlockedCount(),
      }),
    );
    return;
  }

  res.writeHead(426, {
    'Content-Type': 'text/plain',
    Upgrade: 'websocket',
  });
  res.end('Upgrade Required');
});

server.on('upgrade', async (req, clientSocket, head) => {
  clientSocket.on('error', () => {});

  let reqUrl;
  try {
    reqUrl = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    clientSocket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  if (reqUrl.pathname !== '/' && reqUrl.pathname !== '/chromium/playwright') {
    clientSocket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  const queryToken = reqUrl.searchParams.get('token');
  const authHeader = req.headers['authorization'];
  let bearerToken = null;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }

  const candidateToken = queryToken || bearerToken;
  if (!verifyToken(candidateToken)) {
    clientSocket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  if (activeSessions >= MAX_CONCURRENT_SESSIONS) {
    clientSocket.write(
      'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\nContent-Length: 0\r\n\r\n',
    );
    clientSocket.destroy();
    return;
  }

  activeSessions++;
  const sessionStartTime = Date.now();
  let browserServer = null;
  let upstream = null;
  let cleanedUp = false;
  let sessionTimer = null;

  async function cleanup(reason) {
    if (cleanedUp) return;
    cleanedUp = true;
    if (sessionTimer) clearTimeout(sessionTimer);

    if (clientSocket && !clientSocket.destroyed) {
      clientSocket.destroy();
    }
    if (upstream && !upstream.destroyed) {
      upstream.destroy();
    }
    if (browserServer) {
      await browserServer.close().catch(() => {});
    }

    activeSessions = Math.max(0, activeSessions - 1);
    ensureWarmBrowser();
    const durationMs = Date.now() - sessionStartTime;
    console.log(`[Session] closed reason=${reason} durationMs=${durationMs}`);
  }

  sessionTimer = setTimeout(() => {
    void cleanup('max_session_timeout');
  }, MAX_SESSION_MS);

  clientSocket.on('close', () => {
    void cleanup('client_socket_close');
  });
  clientSocket.on('error', () => {
    void cleanup('client_socket_error');
  });

  try {
    browserServer = await acquireBrowserServer();

    if (clientSocket.destroyed) {
      await cleanup('client_disconnected_during_launch');
      return;
    }

    const upstreamUrl = new URL(browserServer.wsEndpoint());
    const upstreamPort = Number(upstreamUrl.port);

    upstream = net.connect(upstreamPort, '127.0.0.1');
    clientSocket.setNoDelay(true);
    upstream.setNoDelay(true);

    upstream.on('close', () => {
      void cleanup('upstream_socket_close');
    });
    upstream.on('error', () => {
      void cleanup('upstream_socket_error');
    });

    upstream.once('connect', () => {
      if (clientSocket.destroyed) {
        void cleanup('client_destroyed_on_connect');
        return;
      }

      const headers = [
        `GET ${upstreamUrl.pathname}${upstreamUrl.search} HTTP/1.1`,
        `Host: 127.0.0.1:${upstreamPort}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
      ];

      for (const [k, v] of Object.entries(req.headers)) {
        const lower = k.toLowerCase();
        if (
          lower === 'sec-websocket-key' ||
          lower === 'sec-websocket-version' ||
          lower === 'sec-websocket-extensions' ||
          lower === 'sec-websocket-protocol' ||
          lower === 'user-agent' ||
          lower.startsWith('x-playwright-')
        ) {
          headers.push(`${k}: ${v}`);
        }
      }

      headers.push('\r\n');
      upstream.write(headers.join('\r\n'));
      if (head && head.length > 0) {
        upstream.write(head);
      }

      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
  } catch (err) {
    console.error('[Session] launch error:', err instanceof Error ? err.message : String(err));
    if (!clientSocket.destroyed) {
      clientSocket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
      clientSocket.destroy();
    }
    await cleanup('launch_failed');
  }
});

const PORT = parseInt(process.env.PORT || '8080', 10);
server.listen(PORT, '0.0.0.0', () => {
  const addr = server.address();
  const actualPort = addr && typeof addr === 'object' ? addr.port : PORT;
  console.log(`[CloudBrowser] listening on 0.0.0.0:${actualPort}`);
  ensureWarmBrowser();
});

async function shutdown(sig) {
  console.log(`[CloudBrowser] shutting down on ${sig}`);
  isShuttingDown = true;
  server.close();
  if (warmBrowserPromise) {
    try {
      const srv = await warmBrowserPromise;
      if (srv) {
        await srv.close().catch(() => {});
      }
    } catch {}
    warmBrowserPromise = null;
  }
  await stopEgressProxy();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
