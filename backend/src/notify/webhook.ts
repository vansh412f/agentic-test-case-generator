import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../config.ts';
import { WEBHOOK_RETRY_DELAY_MS, WEBHOOK_TIMEOUT_MS } from '../agent/run.config.ts';

export interface WebhookTarget { url: string; secret: string; }

export type JobWebhookPayload = {
  event: 'job.finished'; jobId: string; targetUrl: string; finishedAt: string;
} & (
  | { status: 'completed'; tests: { total: number; passed: number; failed: number; gaveUp: number } }
  | { status: 'failed'; errorCode: string }
);

const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) NON_PUBLIC.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv6');
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  const mapped = family === 6 ? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1] : undefined;
  if (mapped) return !NON_PUBLIC.check(mapped, 'ipv4');
  return !NON_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const allowPrivateTargets = (): boolean => config.LOCAL_AGENT_MODE;

export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return 'webhookUrl must be an absolute URL.'; }
  if (url.username || url.password) return 'webhookUrl must not contain credentials.';
  if (allowPrivateTargets()) {
    return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'webhookUrl must use http or https.';
  }
  if (url.protocol !== 'https:') return 'webhookUrl must use https.';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'webhookUrl must point to a public host.';
  }
  if (isIP(host) !== 0 && !isPublicAddress(host)) return 'webhookUrl must point to a public host.';
  return null;
}

export function createWebhookTarget(url: string): WebhookTarget {
  return { url, secret: randomBytes(24).toString('base64url') };
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

// DNS-rebinding between this lookup and fetch's lookup is a known gap (Phase 9A pinned agent).
async function resolvesPublicly(url: URL): Promise<boolean> {
  if (allowPrivateTargets()) return true;
  try {
    const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
  } catch {
    return false;
  }
}

async function postOnce(target: WebhookTarget, body: string, deliveryId: string): Promise<'ok' | 'retry' | 'give_up'> {
  try {
    const response = await fetch(target.url, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'agentic-test-generator-webhook/1',
        'X-Agentic-Event': 'job.finished',
        'X-Agentic-Delivery': deliveryId,
        'X-Agentic-Signature': signWebhookBody(target.secret, body),
      },
      body,
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return 'ok';
    return response.status >= 500 || response.status === 429 ? 'retry' : 'give_up';
  } catch {
    return 'retry';
  }
}

export async function deliverJobWebhook(target: WebhookTarget, payload: JobWebhookPayload): Promise<void> {
  const url = new URL(target.url);
  if (!(await resolvesPublicly(url))) {
    console.warn(`[Webhook] ${payload.jobId}: ${url.host} does not resolve to a public address; skipped.`);
    return;
  }
  const body = JSON.stringify(payload);
  const deliveryId = randomUUID();
  let outcome = await postOnce(target, body, deliveryId);
  if (outcome === 'retry') {
    await sleep(WEBHOOK_RETRY_DELAY_MS);
    outcome = await postOnce(target, body, deliveryId);
  }
  if (outcome !== 'ok') console.warn(`[Webhook] ${payload.jobId}: delivery to ${url.host} failed (${outcome}).`);
}
