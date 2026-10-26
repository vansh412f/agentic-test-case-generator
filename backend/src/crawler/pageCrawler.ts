import { chromium, errors, type Browser } from 'playwright';
import { config, VIEWPORT } from '../config.ts';
import { CrawlError } from './crawlErrors.ts';
import { mapGotoError } from './gotoErrors.ts';
import { extractElements } from './browser/extractElements.ts';
import { extractForms } from './browser/extractForms.ts';
import { buildAppMap } from './appMapBuilder.ts';
import type { AppMap } from './types.ts';

import { assertPublicTarget } from '../security/netPolicy.ts';
import { ensureEgressProxy } from '../security/egressProxy.ts';
import { recordServerEvent } from '../observability/serverEvents.ts';

function assertCrawlableUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new CrawlError('INVALID_URL', `Cannot parse URL: "${url}"`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CrawlError('INVALID_URL', `Unsupported protocol "${parsed.protocol}". Only http and https are allowed.`);
  }
}

export async function launchBrowser(): Promise<Browser> {
  try {
    const proxyUrl = await ensureEgressProxy();
    const proxy = proxyUrl ? { server: proxyUrl } : undefined;
    const baseArgs = [
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ];
    const proxyArgs = proxyUrl ? [
      '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ] : [];
    const args = [...baseArgs, ...proxyArgs];
    return await chromium.launch({
      headless: config.HEADLESS,
      proxy,
      args,
    });
  } catch (err) {
    // Launch errors embed executable paths / missing libs: log, never return.
    console.error(`[Crawler] Browser launch failed: ${err instanceof Error ? err.message : String(err)}`);
    recordServerEvent('error', 'crawler:launch', err);
    throw new CrawlError('BROWSER_LAUNCH_FAILED', 'The crawler browser could not start. Please retry shortly.', err);
  }
}

import { classifyLanding } from './wakeDetect.ts';

const BOT_WALL_TITLE_REGEX =
  /robot check|captcha|are you a human|verify you are human|access denied|just a moment|attention required/i;

export function isBotWall(title: string, htmlProbe: { hasChallengeDom: boolean }): boolean {
  if (BOT_WALL_TITLE_REGEX.test(title)) return true;
  if (htmlProbe.hasChallengeDom) return true;
  return false;
}

import { heavyOpGate } from '../security/concurrencyGate.ts';

const BLOCKED_CRAWL_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

export async function installCrawlResourceFilter(
  context: import('playwright').BrowserContext,
): Promise<void> {
  await context.route('**/*', (route) => {
    if (BLOCKED_CRAWL_RESOURCE_TYPES.has(route.request().resourceType())) {
      void route.abort().catch(() => {});
    } else {
      void route.continue().catch(() => {});
    }
  });
}

export async function closeBrowserSafely(browser: Browser | null | undefined, timeoutMs = 5_000): Promise<void> {
  if (!browser) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function crawlInBrowser(browser: Browser, url: string, maxElements: number): Promise<AppMap> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await installCrawlResourceFilter(context);
  try {
    const page = await context.newPage();
    await page.addInitScript('window.__name = window.__name || ((target) => target);');
    const host = new URL(url).hostname;
    let resp: import('playwright').Response | null = null;
    try {
      resp = await page.goto(url, { waitUntil: 'load', timeout: config.NAVIGATION_TIMEOUT_MS });
    } catch (err) {
      throw mapGotoError(err, url);
    }

    const pageTitle = await page.title().catch(() => '');
    const hasChallengeDom = await page
      .evaluate(() => {
        return Boolean(
          document.querySelector(
            '#challenge-form, #cf-challenge-running, form[action*="validateCaptcha"], iframe[src*="captcha"]',
          ),
        );
      })
      .catch(() => false);

    if (isBotWall(pageTitle, { hasChallengeDom })) {
      throw new CrawlError(
        'TARGET_BLOCKED',
        "This site showed a bot check to our headless browser, so it can't be crawled.",
      );
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
  options?: { signal?: AbortSignal; gateMode?: 'pipeline' | 'preview' },
): Promise<AppMap> {
  assertCrawlableUrl(url);
  await assertPublicTarget(url);
  options?.signal?.throwIfAborted();

  const releaseGate = options?.gateMode === 'preview'
    ? await heavyOpGate.acquirePreview({ signal: options?.signal })
    : await heavyOpGate.acquirePipeline({ signal: options?.signal });

  let browser: Browser | undefined;
  const onAbort = () => {
    if (browser) void browser.close().catch(() => undefined);
  };
  options?.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    options?.signal?.throwIfAborted();
    browser = await launchBrowser();
    return await crawlInBrowser(browser, url, config.MAX_ELEMENTS_PER_PAGE);
  } finally {
    options?.signal?.removeEventListener('abort', onAbort);
    if (browser) {
      await closeBrowserSafely(browser);
    }
    releaseGate();
  }
}
// Module component implementation.
