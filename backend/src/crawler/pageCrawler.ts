import { chromium, errors, type Browser } from 'playwright';
import { config, VIEWPORT } from '../config.ts';
import { CrawlError } from './crawlErrors.ts';
import { extractElements } from './browser/extractElements.ts';
import { extractForms } from './browser/extractForms.ts';
import { buildAppMap } from './appMapBuilder.ts';
import { mergeAppMaps, pickDeepCrawlLinks, type CrawledPage } from './mergeAppMaps.ts';
import type { AppMap } from './types.ts';

import { assertPublicTarget } from '../security/netPolicy.ts';
import { ensureEgressProxy } from '../security/egressProxy.ts';

function assertCrawlableUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new CrawlError('INVALID_URL', `Cannot parse URL: "${url}"`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CrawlError('INVALID_URL', `Unsupported protocol "${parsed.protocol}". Only http and https are allowed.`);
  }
}

async function launchBrowser(): Promise<Browser> {
  try {
    const proxyUrl = await ensureEgressProxy();
    const proxy = proxyUrl ? { server: proxyUrl } : undefined;
    const args = proxyUrl ? [
      '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ] : undefined;
    return await chromium.launch({
      headless: config.HEADLESS,
      proxy,
      args,
    });
  } catch (err) {
    // Launch errors embed executable paths / missing libs: log, never return.
    console.error(`[Crawler] Browser launch failed: ${err instanceof Error ? err.message : String(err)}`);
    throw new CrawlError('BROWSER_LAUNCH_FAILED', 'The crawler browser could not start. Please retry shortly.', err);
  }
}

import { classifyLanding } from './wakeDetect.ts';

async function crawlInBrowser(browser: Browser, url: string, maxElements: number): Promise<AppMap> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  try {
    const page = await context.newPage();
    await page.addInitScript('window.__name = window.__name || ((target) => target);');
    const host = new URL(url).hostname;
    let resp: import('playwright').Response | null = null;
    try {
      resp = await page.goto(url, { waitUntil: 'load', timeout: config.NAVIGATION_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof errors.TimeoutError) {
        const landing = classifyLanding({ host, timedOut: true });
        if (landing === 'waking') {
          throw new CrawlError('TARGET_WAKING', `${host} is waking up from sleep.`, err, { host, retryAfterSeconds: 30 });
        }
        throw new CrawlError('NAVIGATION_TIMEOUT', `Page did not load within ${config.NAVIGATION_TIMEOUT_MS}ms: ${url}`, err);
      }
      throw new CrawlError('NAVIGATION_FAILED', `Failed to navigate to ${url}: ${(err as Error).message}`, err);
    }

    const status = resp?.status();
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 2048) : '').catch(() => '');
    const initialLanding = classifyLanding({ host, status, bodyText, elementCount: 0 });
    if (initialLanding === 'tunnel_host_blocked') {
      throw new CrawlError('TUNNEL_HOST_BLOCKED', `Tunnel host blocked by dev server.`, undefined, { host });
    }
    if (initialLanding === 'waking') {
      throw new CrawlError('TARGET_WAKING', `${host} is waking up from sleep.`, undefined, { host, retryAfterSeconds: 30 });
    }

    if (config.NETWORK_IDLE_WAIT_MS > 0) {
      try {
        await page.waitForLoadState('networkidle', { timeout: config.NETWORK_IDLE_WAIT_MS });
      } catch (err) {
        if (!(err instanceof errors.TimeoutError)) {
          throw new CrawlError('NAVIGATION_FAILED', `Page became unavailable after load: ${(err as Error).message}`, err);
        }
      }
    }
    try {
      const [elementsResult, forms] = await Promise.all([
        page.evaluate(extractElements, { maxElements }),
        page.evaluate(extractForms),
      ]);
      const finalLanding = classifyLanding({
        host,
        status,
        bodyText,
        elementCount: elementsResult.elements.length,
      });
      if (finalLanding === 'tunnel_host_blocked') {
        throw new CrawlError('TUNNEL_HOST_BLOCKED', `Tunnel host blocked by dev server.`, undefined, { host });
      }
      if (finalLanding === 'waking') {
        throw new CrawlError('TARGET_WAKING', `${host} is waking up from sleep.`, undefined, { host, retryAfterSeconds: 30 });
      }

      const title = await page.title();
      return buildAppMap({ url: page.url(), viewport: VIEWPORT, extraction: { title, ...elementsResult, forms } });
    } catch (err) {
      if (err instanceof CrawlError) throw err;
      throw new CrawlError('EXTRACTION_FAILED', 'Failed to extract or build App Map', err);
    }
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function crawlPage(
  url: string,
  options?: { signal?: AbortSignal },
): Promise<AppMap> {
  assertCrawlableUrl(url);
  await assertPublicTarget(url);
  options?.signal?.throwIfAborted();
  const browser = await launchBrowser();
  const onAbort = () => {
    void browser.close().catch(() => undefined);
  };
  options?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    options?.signal?.throwIfAborted();
    return await crawlInBrowser(browser, url, config.MAX_ELEMENTS_PER_PAGE);
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
    await browser.close().catch(() => undefined);
  }
}

export interface DeepCrawlOptions {
  maxPages: number;
  startPageElementCap: number;
  extraPageElementCap: number;
  signal?: AbortSignal;
}

// Start page is mandatory; extra pages that fail are skipped. One browser, sequential contexts.
export async function crawlSite(url: string, options: DeepCrawlOptions): Promise<AppMap> {
  assertCrawlableUrl(url);
  await assertPublicTarget(url);
  options?.signal?.throwIfAborted();
  const browser = await launchBrowser();
  const onAbort = () => {
    void browser.close().catch(() => undefined);
  };
  options?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    options?.signal?.throwIfAborted();
    const start = await crawlInBrowser(browser, url, options.startPageElementCap);
    const extras: CrawledPage[] = [];
    for (const link of pickDeepCrawlLinks(start, options.maxPages - 1)) {
      options?.signal?.throwIfAborted();
      try {
        await assertPublicTarget(link);
        extras.push({ requestedUrl: link, map: await crawlInBrowser(browser, link, options.extraPageElementCap) });
      } catch (err) {
        if (options?.signal?.aborted) throw err;
        console.warn(`[Crawler] Deep crawl skipped ${link}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return mergeAppMaps(start, extras);
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
    await browser.close().catch(() => undefined);
  }
}