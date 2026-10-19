import net from 'node:net';

// When AGT_EGRESS_PROXY is set, the Playwright runner process and its workers
// may only open TCP connections to 127.0.0.1:<proxy port>.
// Everything else throws EACCES "egress blocked".
// Unix domain sockets and named pipes (Chromium IPC) are untouched.

const proxyUrl = process.env.AGT_EGRESS_PROXY;
if (proxyUrl) {
  let proxyPort = 0;
  try {
    const parsed = new URL(proxyUrl);
    proxyPort = parseInt(parsed.port, 10);
  } catch {}

  if (proxyPort > 0) {
    const originalConnect = net.Socket.prototype.connect;

    net.Socket.prototype.connect = function (...args) {
      let isPipe = false;
      let targetHost = 'localhost';
      let targetPort = 0;

      let first = args[0];
      if (Array.isArray(first)) {
        first = first[0];
      }

      if (typeof first === 'object' && first !== null) {
        if (first.path) {
          isPipe = true;
        } else {
          targetPort = Number(first.port);
          const rawHost = first.host ?? first.hostname ?? 'localhost';
          targetHost = String(rawHost).toLowerCase();
        }
      } else if (typeof first === 'string' && !/^\d+$/.test(first)) {
        isPipe = true;
      } else if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
        targetPort = Number(first);
        if (typeof args[1] === 'string') {
          targetHost = args[1].toLowerCase();
        }
      }

      if (isPipe) {
        return originalConnect.apply(this, args);
      }

      targetHost = targetHost.replace(/^\[|\]$/g, '');

      const isLoopback =
        targetHost === '127.0.0.1' ||
        targetHost === 'localhost' ||
        targetHost === '::1';

      if (isLoopback && targetPort === proxyPort) {
        return originalConnect.apply(this, args);
      }

      const err = Object.assign(new Error('egress blocked'), { code: 'EACCES' });
      throw err;
    };
  }
}
