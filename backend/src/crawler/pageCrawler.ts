import { chromium, errors } from 'playwright';
import { config, VIEWPORT } from '../config.ts';
import { CrawlError } from './crawlErrors.ts';
import { extractElements } from './browser/extractElements.ts';
import { extractForms } from './browser/extractForms.ts';
import { buildAppMap } from './appMapBuilder.ts';

export async function crawlPage(url: string) {
  // Validate URL before launching anything expensive 
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CrawlError('INVALID_URL', `Cannot parse URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CrawlError(
      'INVALID_URL',
      `Unsupported protocol "${parsed.protocol}". Only http and https are allowed.`,
    );
  }

  // Launch a fresh browser 
  const browser = await chromium.launch({ headless: config.HEADLESS });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();

    // Defuse the tsx/esbuild __name helper 
    await page.addInitScript(
      'window.__name = window.__name || ((target) => target);',
    );

    try {
      await page.goto(url, {
        waitUntil: 'load',
        timeout: config.NAVIGATION_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof errors.TimeoutError) {
        throw new CrawlError(
          'NAVIGATION_TIMEOUT',
          `Page did not load within ${config.NAVIGATION_TIMEOUT_MS}ms: ${url}`,
          err,
        );
      }
      throw new CrawlError(
        'NAVIGATION_FAILED',
        `Failed to navigate to ${url}: ${(err as Error).message}`,
        err,
      );
    }

    // Best-effort networkidle
    if (config.NETWORK_IDLE_WAIT_MS > 0) {
      try {
        await page.waitForLoadState('networkidle', {
          timeout: config.NETWORK_IDLE_WAIT_MS,
        });
      } catch (err) {
        if (!(err instanceof errors.TimeoutError)) {
          throw err;
        }
        // Timeout is expected for pages with polling/websockets
      }
    }

    // Extract elements and forms from the live DOM 
    try {
      const [elementsResult, forms] = await Promise.all([
        page.evaluate(extractElements, {
          maxElements: config.MAX_ELEMENTS_PER_PAGE,
        }),
        page.evaluate(extractForms),
      ]);
      const title = await page.title();

      // Build and validate the App Map 
      return buildAppMap({
        url: page.url(),
        viewport: VIEWPORT,
        extraction: { title, ...elementsResult, forms },
      });
    } catch (err) {
      if (err instanceof CrawlError) throw err;
      throw new CrawlError('EXTRACTION_FAILED', 'Failed to extract or build App Map', err);
    }
  } finally {
    await browser.close();
  }
}