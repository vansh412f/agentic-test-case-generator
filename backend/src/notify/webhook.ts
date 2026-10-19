import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../config.ts';
import { WEBHOOK_RETRY_DELAY_MS, WEBHOOK_TIMEOUT_MS } from '../agent/run.config.ts';
import { recordServerEvent } from '../observability/serverEvents.ts';

export interface WebhookTarget { url: string; secret: string; }

export type JobWebhookPayload = {
  event: 'job.finished'; jobId: string; targetUrl: string; finishedAt: string;
} & (
  | { status: 'completed'; tests: { total: number; passed: number; failed: number; gaveUp: number; needsReview: number } }
  | { status: 'failed'; errorCode: string }
  | { status: 'cancelled'; errorCode: null }
);

import { NON_PUBLIC, isPublicAddress } from '../security/netPolicy.ts';
export { NON_PUBLIC, isPublicAddress };

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
  if (outcome !== 'ok') {
    console.warn(`[Webhook] ${payload.jobId}: delivery to ${url.host} failed (${outcome}).`);
    recordServerEvent(
      'warn',
      'webhook:delivery',
      `Webhook delivery to ${url.host} failed (${outcome})`,
      { jobId: payload.jobId },
      payload.jobId,
    );
  }
}
// Module component implementation.
