import { defineConfig } from '@playwright/test';

const proxyServer = process.env.AGT_EGRESS_PROXY;
const proxy = proxyServer ? { server: proxyServer } : undefined;
const launchOptions = proxyServer
  ? {
      args: [
        '--proxy-bypass-list=<-loopback>',
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      ],
    }
  : undefined;

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  reporter: [['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ?? 'results.json' }]],
  use: {
    actionTimeout: 10_000,
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 720 },
    proxy,
    launchOptions,
  },
});
