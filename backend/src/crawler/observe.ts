import type { Browser } from 'playwright';
import { VIEWPORT } from '../config.ts';
import type { AppMap, InteractiveElement, Observation } from './types.ts';
import { launchBrowser, installCrawlResourceFilter, closeBrowserSafely } from './pageCrawler.ts';
import { heavyOpGate } from '../security/concurrencyGate.ts';
import { isSkipLink } from './appMapBuilder.ts';
import { resolveTestData } from '../agent/testData.ts';
import type { TestDataEntry } from '../api/schemas.ts';
import { isPrivateOrLoopbackHost } from '../security/targetUrl.ts';

export interface ObserveOptions {
  testData?: TestDataEntry[];
  signal?: AbortSignal;
  deadlineMs?: number;
}

const OVERALL_DEADLINE_MS = 45_000;
const ACTION_TIMEOUT_MS = 5_000;
const MAX_OBSERVATIONS = 25;

function scrubSecrets(text: string, secrets?: Map<string, string>): string {
  if (!secrets || secrets.size === 0) return text;
  let result = text;
  for (const [token, secretValue] of secrets.entries()) {
    if (secretValue && secretValue.length > 0) {
      result = result.split(secretValue).join(token);
    }
  }
  return result;
}

export function normalizeObservedText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s×✕✖]+$/u, '')
    .trim()
    .slice(0, 120);
}

export function isObservableHref(href: string, baseUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(href, baseUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (isPrivateOrLoopbackHost(u.hostname)) return false;
  return true;
}

export async function observeAppMap(
  appMap: AppMap,
  options?: ObserveOptions,
): Promise<Observation[]> {
  const observations: Observation[] = [];
  const startTime = Date.now();
  const deadlineMs = options?.deadlineMs ?? OVERALL_DEADLINE_MS;

  function isExpired(): boolean {
    return Date.now() - startTime >= deadlineMs || Boolean(options?.signal?.aborted);
  }

  if (isExpired()) return [];

  let releaseGate: (() => void) | undefined;
  try {
    releaseGate = await heavyOpGate.acquirePipeline({ signal: options?.signal });
  } catch {
    return [];
  }

  let browser: Browser | null = null;
  let context: import('playwright').BrowserContext | null = null;
  let hardStopped = false;
  let deadlineTimer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;

  try {
    if (isExpired()) return [];

    const remainingBudget = Math.max(1, deadlineMs - (Date.now() - startTime));
    deadlineTimer = setTimeout(() => {
      hardStopped = true;
      if (browser) void browser.close().catch(() => {});
    }, remainingBudget);

    if (options?.signal) {
      onAbort = () => {
        hardStopped = true;
        if (browser) void browser.close().catch(() => {});
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    browser = await launchBrowser();
    if (isExpired() || hardStopped) return [];

    context = await browser.newContext({ viewport: VIEWPORT });
    await installCrawlResourceFilter(context);
    const page = await context.newPage();

    async function resetPage(): Promise<void> {
      if (isExpired() || hardStopped) return;
      await page.goto(appMap.url, { waitUntil: 'domcontentloaded', timeout: ACTION_TIMEOUT_MS });
      try {
        await page.waitForLoadState('networkidle', { timeout: 2000 });
      } catch {
        // swallowed on timeout
      }
    }

    try {
      await resetPage();
    } catch {
      return [];
    }

    if (isExpired() || hardStopped) return [];

    // 1. COUNTS: up to 5 repeated-item containers
    try {
      const countResults = await page.evaluate(() => {
        const containers = Array.from(
          document.querySelectorAll('ul, ol, [role="list"], table, select'),
        );
        const results: Array<{
          containerCss: string;
          role: string;
          containerCount: number;
          pageCount: number;
        }> = [];

        function getContainerCss(el: Element): string {
          if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
            return '#' + CSS.escape(el.id);
          }
          const parts: string[] = [];
          let curr: Element | null = el;
          while (
            curr &&
            curr.tagName &&
            curr !== document.body &&
            curr !== document.documentElement
          ) {
            const parent: Element | null = curr.parentElement;
            if (!parent) {
              parts.unshift(curr.tagName.toLowerCase());
              break;
            }
            const siblings = Array.from(parent.children).filter(
              (c) => c.tagName === curr!.tagName,
            );
            const index = siblings.indexOf(curr) + 1;
            const tag = curr.tagName.toLowerCase();
            parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
            curr = parent;
          }
          return parts.length ? parts.join(' > ') : el.tagName.toLowerCase();
        }

        for (const container of containers) {
          if (results.length >= 5) break;

          const tag = container.tagName.toUpperCase();
          const ariaRole = container.getAttribute('role');

          let childSelector = '';
          let childRole = '';

          if (tag === 'TABLE') {
            childSelector = 'tr';
            childRole = 'row';
          } else if (tag === 'SELECT') {
            childSelector = 'option';
            childRole = 'option';
          } else if (tag === 'UL' || tag === 'OL' || ariaRole === 'list') {
            childSelector = 'li, [role="listitem"]';
            childRole = 'listitem';
          }

          if (!childSelector || !childRole) continue;

          const items = container.querySelectorAll(childSelector);
          if (items.length >= 2) {
            const totalPageItems = document.querySelectorAll(childSelector).length;
            results.push({
              containerCss: getContainerCss(container),
              role: childRole,
              containerCount: items.length,
              pageCount: totalPageItems,
            });
          }
        }

        return results;
      });

      for (const cr of countResults) {
        if (isExpired() || observations.length >= MAX_OBSERVATIONS) break;
        const matchingEl = appMap.elements.find((e) => e.ariaRole === cr.role);
        observations.push({
          kind: 'count',
          elementId: matchingEl ? matchingEl.id : null,
          fromUrl: appMap.url,
          role: cr.role,
          containerCss: cr.containerCss,
          containerCount: cr.containerCount,
          pageCount: cr.pageCount,
          visibleTexts: [],
        });
      }
    } catch {
      // count evaluate failure swallowed
    }

    // 2. LINKS: up to 6 eligible links
    const candidateLinks = appMap.elements.filter((el) => {
      if (el.type !== 'link') return false;
      if (!el.isVisible) return false;
      if (!el.href) return false;
      const href = el.href.trim();
      if (href.startsWith('#') || href.startsWith('javascript:')) return false;
      if (isSkipLink(el)) return false;
      return isObservableHref(href, appMap.url);
    });

    let linksProcessed = 0;
    for (const el of candidateLinks) {
      if (isExpired() || observations.length >= MAX_OBSERVATIONS || linksProcessed >= 6) break;
      if (options?.signal?.aborted) return [];

      try {
        const loc = page.locator(el.selectors.css).first();
        if ((await loc.count()) === 0) continue;
        if (!(await loc.isVisible().catch(() => false))) continue;

        const target = await loc.getAttribute('target').catch(() => null);
        const isPopup = target === '_blank';

        if (isPopup) {
          const [popup] = await Promise.all([
            context.waitForEvent('page', { timeout: ACTION_TIMEOUT_MS }).catch(() => null),
            loc.click({ timeout: ACTION_TIMEOUT_MS }),
          ]);
          if (popup) {
            try {
              await popup.waitForLoadState('domcontentloaded').catch(() => {});
              const finalUrl = popup.url();
              const title = await popup.title().catch(() => null);
              observations.push({
                kind: 'popup',
                elementId: el.id,
                fromUrl: appMap.url,
                finalUrl,
                title,
                visibleTexts: [],
              });
              linksProcessed++;
            } finally {
              await popup.close().catch(() => {});
            }
          } else {
            if (isExpired() || hardStopped) break;
            await resetPage().catch(() => {});
          }
        } else {
          await loc.click({ timeout: ACTION_TIMEOUT_MS });
          await page.waitForLoadState('domcontentloaded', { timeout: ACTION_TIMEOUT_MS }).catch(() => {});
          const finalUrl = page.url();
          const title = await page.title().catch(() => null);
          const firstH1 = await page
            .locator('h1')
            .filter({ hasText: /.+/ })
            .first()
            .innerText({ timeout: 1000 })
            .catch(() => '');
          const normalizedH1 = normalizeObservedText(firstH1);
          const visibleTexts = normalizedH1 ? [normalizedH1] : [];

          observations.push({
            kind: 'navigation',
            elementId: el.id,
            fromUrl: appMap.url,
            finalUrl,
            title,
            visibleTexts,
          });
          linksProcessed++;
          await resetPage();
        }
      } catch {
        if (isExpired() || hardStopped) break;
        await resetPage().catch(() => {});
      }
    }

    // 3. FORMS: up to 3 forms having visible submit button
    const resolvedData = options?.testData?.length
      ? resolveTestData(appMap, options.testData)
      : undefined;

    let formsProcessed = 0;
    for (const form of appMap.forms) {
      if (isExpired() || observations.length >= MAX_OBSERVATIONS || formsProcessed >= 3) break;
      if (options?.signal?.aborted) return [];

      if (!form.submitButtonId) continue;
      const submitEl = appMap.elements.find((e) => e.id === form.submitButtonId);
      if (!submitEl || !submitEl.isVisible) continue;

      // 3a: EMPTY SUBMIT
      try {
        const submitLoc = page.locator(submitEl.selectors.css).first();
        if ((await submitLoc.count()) === 0 || !(await submitLoc.isVisible().catch(() => false))) {
          continue;
        }

        await submitLoc.click({ timeout: ACTION_TIMEOUT_MS });
        await new Promise((r) => setTimeout(r, 800));
        try {
          await page.waitForLoadState('networkidle', { timeout: 2000 });
        } catch {
          // best-effort
        }

        const finalUrl = page.url();
        const title = await page.title().catch(() => null);
        const rawVisibleTexts = await page
          .evaluate(() => {
            const selectors = [
              '[role="alert"]',
              '[class*="error" i]',
              '[class*="invalid" i]',
              '[class*="flash" i]',
            ];
            const nodes = Array.from(document.querySelectorAll(selectors.join(', ')));
            const texts: string[] = [];
            for (const node of nodes) {
              if (texts.length >= 5) break;
              const txt = ((node as HTMLElement).innerText || node.textContent || '').trim();
              if (txt && !texts.includes(txt)) {
                texts.push(txt);
              }
            }
            const h1 = document.querySelector('h1');
            if (h1 && texts.length < 5) {
              const h1Text = (h1.innerText || h1.textContent || '').trim();
              if (h1Text && !texts.includes(h1Text)) {
                texts.push(h1Text);
              }
            }
            return texts;
          })
          .catch(() => []);

        const visibleTexts: string[] = [];
        for (const raw of rawVisibleTexts) {
          const norm = normalizeObservedText(raw);
          if (norm && !visibleTexts.includes(norm)) {
            visibleTexts.push(norm);
          }
        }

        observations.push({
          kind: 'form_empty_submit',
          formId: form.id,
          elementId: form.submitButtonId,
          fromUrl: appMap.url,
          finalUrl,
          title,
          visibleTexts,
        });

        await resetPage();
      } catch {
        if (isExpired() || hardStopped) break;
        await resetPage().catch(() => {});
      }

      // 3b: FILLED SUBMIT (only if testData fills cover every visible field)
      if (resolvedData && resolvedData.fills.size > 0) {
        if (isExpired() || hardStopped || observations.length >= MAX_OBSERVATIONS) break;

        const formFields = form.fieldIds
          .map((id) => appMap.elements.find((e) => e.id === id))
          .filter(
            (e): e is InteractiveElement =>
              Boolean(e) &&
              e!.isVisible &&
              ['input', 'textarea', 'select'].includes(e!.type),
          );

        const canFill =
          formFields.length > 0 &&
          formFields.every((f) => resolvedData.fills.has(f.id));

        if (canFill) {
          let filledOk = true;
          try {
            for (const f of formFields) {
              const fillVal = resolvedData.fills.get(f.id)!;
              let actualValue = fillVal;
              if (/^__AGT_SECRET_\d+__$/.test(fillVal)) {
                const realSecret = resolvedData.secrets.get(fillVal);
                if (!realSecret) {
                  filledOk = false;
                  break;
                }
                actualValue = realSecret;
              }

              const fieldLoc = page.locator(f.selectors.css).first();
              if (f.type === 'select') {
                await fieldLoc.selectOption(actualValue, { timeout: ACTION_TIMEOUT_MS });
              } else {
                await fieldLoc.fill(actualValue, { timeout: ACTION_TIMEOUT_MS });
              }
            }

            if (filledOk) {
              const preSubmitUrl = page.url();
              const submitLoc = page.locator(submitEl.selectors.css).first();
              await submitLoc.click({ timeout: ACTION_TIMEOUT_MS });

              // Bounded readiness poll up to 3500ms (500ms initial wait, then 250ms polling)
              await new Promise((r) => setTimeout(r, 500));
              const waitDeadline = Date.now() + 3000;
              while (Date.now() < waitDeadline && !isExpired() && !hardStopped) {
                const currentUrl = page.url();
                if (currentUrl !== preSubmitUrl) {
                  break;
                }
                const hasAlert = await page
                  .evaluate(() => {
                    const sel = '[role="alert"], [class*="error" i], [class*="invalid" i], [class*="flash" i]';
                    const nodes = Array.from(document.querySelectorAll(sel));
                    return nodes.some((n) => {
                      const txt = ((n as HTMLElement).innerText || n.textContent || '').trim();
                      return txt.length > 0;
                    });
                  })
                  .catch(() => false);
                if (hasAlert) {
                  break;
                }
                await new Promise((r) => setTimeout(r, 250));
              }

              await page.waitForLoadState('domcontentloaded', { timeout: 1500 }).catch(() => {});
              try {
                await page.waitForLoadState('networkidle', { timeout: 2000 });
              } catch {
                // best-effort
              }

              const rawFinalUrl = page.url();
              const title = await page.title().catch(() => null);
              const rawVisibleTexts = await page
                .evaluate(() => {
                  const alertSelectors = [
                    '[role="alert"]',
                    '[class*="error" i]',
                    '[class*="invalid" i]',
                    '[class*="flash" i]',
                  ];
                  const alertNodes = Array.from(document.querySelectorAll(alertSelectors.join(', ')));
                  const texts: string[] = [];
                  for (const node of alertNodes) {
                    if (texts.length >= 5) break;
                    const txt = ((node as HTMLElement).innerText || node.textContent || '').trim();
                    if (txt && !texts.includes(txt)) {
                      texts.push(txt);
                    }
                  }

                  // Also check primary headings/titles for visible non-empty text (<= 80 chars, no newlines)
                  if (texts.length < 5) {
                    const headingSelectors = [
                      'h1',
                      'h2',
                      '[role="heading"]',
                      '[data-test="title"]',
                      '[class*="title" i]',
                    ];
                    const headingNodes = Array.from(document.querySelectorAll(headingSelectors.join(', ')));
                    for (const node of headingNodes) {
                      if (texts.length >= 5) break;
                      const txt = ((node as HTMLElement).innerText || node.textContent || '').trim();
                      if (txt && txt.length <= 80 && !txt.includes('\n') && !texts.includes(txt)) {
                        texts.push(txt);
                      }
                    }
                  }
                  return texts;
                })
                .catch(() => []);

              const finalUrl = scrubSecrets(rawFinalUrl, resolvedData.secrets);
              const visibleTexts: string[] = [];
              for (const raw of rawVisibleTexts) {
                const scrubbed = scrubSecrets(raw, resolvedData.secrets);
                const norm = normalizeObservedText(scrubbed);
                if (norm && !visibleTexts.includes(norm)) {
                  visibleTexts.push(norm);
                }
              }

              observations.push({
                kind: 'form_filled_submit',
                formId: form.id,
                elementId: form.submitButtonId,
                fromUrl: appMap.url,
                finalUrl,
                title,
                visibleTexts,
              });
            }
          } catch {
            // failed fill abandoned
          } finally {
            if (!isExpired() && !hardStopped) {
              await resetPage().catch(() => {});
            }
          }
        }
      }

      formsProcessed++;
    }
  } catch (err) {
    console.warn(
      '[Observe] failed:',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (onAbort && options?.signal) {
      options.signal.removeEventListener('abort', onAbort);
    }
    await context?.close().catch(() => {});
    await closeBrowserSafely(browser);
    releaseGate?.();
  }

  // Normalize observed texts uniformly (no newlines, no trailing close glyphs, no dupes).
  for (const obs of observations) {
    if (!obs.visibleTexts || obs.visibleTexts.length === 0) continue;
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const t of obs.visibleTexts) {
      const n = normalizeObservedText(t);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      normalized.push(n);
    }
    obs.visibleTexts = normalized;
  }

  return observations;
}
