import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.ts';

function secret(): string {
  if (config.VISITOR_SIGNING_SECRET) return config.VISITOR_SIGNING_SECRET;
  return createHmac('sha256', config.DATABASE_URL).update('visitor-v1').digest('hex');
}

export function mintVisitorToken(): { visitorId: string; token: string } {
  const visitorId = randomUUID();
  return { visitorId, token: `${visitorId}.${sign(visitorId)}` };
}

function sign(visitorId: string): string {
  return createHmac('sha256', secret()).update(visitorId).digest('base64url');
}

export function parseVisitorToken(token: string | undefined): string | null {
  if (!token) return null;
  const [visitorId, signature, extra] = token.split('.');
  if (!visitorId || !signature || extra !== undefined) return null;
  const expected = sign(visitorId);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return visitorId;
}
