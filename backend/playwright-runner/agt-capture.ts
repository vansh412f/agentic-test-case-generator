import { test as baseTest } from '@playwright/test';

export * from '@playwright/test';

export interface AgtFailureContext {
  finalUrl: string;
  navigations: string[];
}

export const test = baseTest.extend<{ _agtCapture: void }>({
  _agtCapture: [
    async ({ page }, use, testInfo) => {
      const navigations: string[] = [];

      page.on('framenavigated', (frame) => {
        try {
          if (frame === page.mainFrame() && navigations.length < 20) {
            navigations.push(frame.url());
          }
        } catch {
          // Ignore frame navigation tracking errors
        }
      });

      await use();

      if (testInfo.status !== testInfo.expectedStatus) {
        let finalUrl = '';
        try {
          finalUrl = page.url();
        } catch {
          finalUrl = navigations[navigations.length - 1] ?? '';
        }

        try {
          await testInfo.attach('agt-failure-context', {
            body: JSON.stringify({ finalUrl, navigations }),
            contentType: 'application/json',
          });
        } catch {
          // Best effort attachment
        }
      }
    },
    { auto: true },
  ],
});
