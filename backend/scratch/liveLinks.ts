import { crawlPage } from '../src/crawler/pageCrawler.ts';
import { CrawlError } from '../src/crawler/crawlErrors.ts';

interface LinkResult {
  url: string;
  status: string;
  title: string;
  totalUnique: number;
  linksCount: number;
  sampleLabels: string[];
  error?: string;
}

const TARGET_URLS = [
  'https://www.amazon.in/',
  'https://www.flipkart.com/',
  'https://en.wikipedia.org/wiki/Main_Page',
  'https://github.com/',
  'https://www.bbc.com/',
  'https://stackoverflow.com/',
  'https://www.reddit.com/',
  'https://www.youtube.com/',
  'https://demo.playwright.dev/todomvc/',
  'https://the-internet.herokuapp.com/',
  'https://www.saucedemo.com/',
  'https://practicetestautomation.com/practice-test-login/',
];

async function testUrl(url: string): Promise<LinkResult> {
  console.log(`Crawling ${url}...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);

  try {
    const appMap = await crawlPage(url, { signal: controller.signal });
    clearTimeout(timeout);
    const labels = appMap.discoveredLinkLabels ?? {};
    const sampleLabels = Object.values(labels).slice(0, 3);

    return {
      url,
      status: 'OK',
      title: appMap.title.slice(0, 40),
      totalUnique: appMap.discoveredLinkTotal ?? appMap.discoveredLinks.length,
      linksCount: appMap.discoveredLinks.length,
      sampleLabels,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof CrawlError) {
      return {
        url,
        status: err.code,
        title: '—',
        totalUnique: 0,
        linksCount: 0,
        sampleLabels: [],
        error: err.message,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      url,
      status: 'ERROR',
      title: '—',
      totalUnique: 0,
      linksCount: 0,
      sampleLabels: [],
      error: msg.slice(0, 80),
    };
  }
}

async function main() {
  console.log('=== Starting Section D Live Links Test (12 URLs) ===\n');
  const results: LinkResult[] = [];

  for (const url of TARGET_URLS) {
    const res = await testUrl(url);
    results.push(res);
    console.log(`  -> Status: ${res.status}, Links: ${res.linksCount} (total ${res.totalUnique}), Sample labels: ${res.sampleLabels.join(', ') || 'none'}\n`);
  }

  console.log('\n========================================================================================================');
  console.log('| URL | Status | Total Unique | Capped (<=20) | Sample Labels | Title / Note |');
  console.log('| :--- | :---: | :---: | :---: | :--- | :--- |');
  for (const r of results) {
    const sample = r.sampleLabels.length > 0 ? r.sampleLabels.join(', ') : (r.error ? `Error: ${r.error}` : '—');
    console.log(`| ${r.url} | ${r.status} | ${r.totalUnique} | ${r.linksCount} | ${sample} | ${r.title} |`);
  }
  console.log('========================================================================================================\n');
}

main().catch(console.error);
