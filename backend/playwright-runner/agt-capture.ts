import { test as baseTest } from '@playwright/test';

export * from '@playwright/test';

export interface AgtFailureContext {
  finalUrl: string;
  navigations: string[];
}

let prototypesPatched = false;

function patchGoto(proto: any) {
  if (!proto || typeof proto.goto !== 'function') return;
  const originalGoto = proto.goto;
  proto.goto = async function (url: string | URL, ...rest: any[]) {
    const rawUrl = typeof url === 'string' ? url : url?.toString() ?? '';
    let parsedProtocol = '';
    try {
      const parsed = new URL(rawUrl);
      parsedProtocol = parsed.protocol;
    } catch {
      if (rawUrl === 'about:blank') {
        parsedProtocol = 'about:';
      }
    }
    const isAboutBlank = rawUrl === 'about:blank' || (parsedProtocol === 'about:' && rawUrl === 'about:blank');
    const isHttp = parsedProtocol === 'http:' || parsedProtocol === 'https:';
    if (!isHttp && !isAboutBlank) {
      throw new Error('Navigation blocked: only http(s) URLs are allowed');
    }
    return originalGoto.call(this, url, ...rest);
  };
}

export const test = baseTest.extend<{ _agtCapture: void }>({
  _agtCapture: [
    async ({ page }, use, testInfo) => {
      if (!prototypesPatched) {
        const pageProto = Object.getPrototypeOf(page);
        const frameProto = Object.getPrototypeOf(page.mainFrame());
        patchGoto(pageProto);
        patchGoto(frameProto);
        prototypesPatched = true;
      }

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
