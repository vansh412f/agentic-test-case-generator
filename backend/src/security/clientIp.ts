import crypto from 'node:crypto';
import net from 'node:net';
import type { Request } from 'express';
import { config } from '../config.ts';

export function clientIp(req: Request): string {
  const edgeSecretHeader = req.header('x-agt-edge-secret');
  const configuredSecret = config.EDGE_SHARED_SECRET;

  if (configuredSecret && edgeSecretHeader) {
    const headerBuf = Buffer.from(edgeSecretHeader);
    const secretBuf = Buffer.from(configuredSecret);

    if (headerBuf.length === secretBuf.length && crypto.timingSafeEqual(headerBuf, secretBuf)) {
      const edgeClientIp = req.header('x-agt-client-ip')?.trim();
      if (edgeClientIp && net.isIP(edgeClientIp)) {
        return edgeClientIp;
      }
    }
  }

  return req.ip || '127.0.0.1';
}
