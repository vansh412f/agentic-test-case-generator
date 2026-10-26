import { defineConfig } from '@playwright/test';

process.umask(0o007);

const proxyServer = process.env.AGT_EGRESS_PROXY;
const proxy = proxyServer ? { server: proxyServer } : undefined;

const baseArgs = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

const proxyArgs = proxyServer
  ? [
      '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ]
  : [];

const launchOptions = {
  args: [...baseArgs, ...proxyArgs],
};

const scale = Math.max(1, parseFloat(process.env.RUNNER_TIMEOUT_SCALE ?? '1') || 1);

const wsEndpoint = process.env.AGT_BROWSER_WS_ENDPOINT?.trim() || undefined;

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: Math.round(15_000 * scale),
  expect: { timeout: Math.round(5_000 * Math.min(scale, 1.4)) },
  reporter: [['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ?? 'results.json' }]],
  use: {
    actionTimeout: Math.round(10_000 * Math.min(scale, 1.2)),
    navigationTimeout: Math.min(Math.round(15_000 * scale), 25_000),
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 720 },
    ...(wsEndpoint
      ? {
          connectOptions: { wsEndpoint, timeout: 30_000 },
          proxy: undefined,
          launchOptions: undefined,
        }
      : {
          proxy,
          launchOptions,
        }),
  },
});
