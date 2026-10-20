import { useEffect, useState } from 'react';
import type { AppProps } from 'next/app';
import { DM_Mono, Manrope } from 'next/font/google';
import Script from 'next/script';
import { SWRConfig } from 'swr';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { RouteFocusManager } from '@/components/layout/RouteFocusManager';
import { ActiveJobsDock } from '@/components/layout/ActiveJobsDock';
import { fetcher, resolveUrl } from '@/lib/api';
import '@/styles/globals.css';

const sans = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  preload: true,
});

const mono = DM_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  preload: true,
});

function ServerWakeBanner() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const startTime = Date.now();
    const MAX_DURATION_MS = 120_000;

    async function checkHealth(timeoutMs: number): Promise<boolean> {
      try {
        const signal =
          typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(timeoutMs)
            : undefined;
        const res = await fetch(resolveUrl('/api/health'), { signal });
        return res.ok;
      } catch {
        return false;
      }
    }

    async function poll() {
      if (cancelled) return;
      const ok = await checkHealth(4000);
      if (cancelled) return;
      if (ok) {
        setWaking(false);
        return;
      }
      if (Date.now() - startTime < MAX_DURATION_MS) {
        timerId = setTimeout(poll, 5000);
      } else {
        setWaking(false);
      }
    }

    void checkHealth(3000).then((ok) => {
      if (cancelled) return;
      if (!ok) {
        setWaking(true);
        timerId = setTimeout(poll, 5000);
      }
    });

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  if (!waking) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-[#fffbeb] border-b border-[#fef3c7] text-[#92400e] px-4 py-2 text-center text-xs font-medium flex items-center justify-center gap-2"
    >
      <span className="inline-block w-2 h-2 rounded-full bg-[#d97706] animate-pulse" />
      <span>Waking the free server (~1 min)…</span>
    </div>
  );
}

export default function App({ Component, pageProps }: AppProps) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <div className={`${sans.variable} ${mono.variable} font-sans`}>
      <ServerWakeBanner />
      {gaId ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${gaId}', { anonymize_ip: true });
            `}
          </Script>
        </>
      ) : null}

      <SWRConfig
        value={{
          fetcher,
          shouldRetryOnError: false,
        }}
      >
        <MotionConfig reducedMotion="user">
          <Layout>
            <RouteFocusManager />
            <Component {...pageProps} />
            <ActiveJobsDock />
          </Layout>
          <Toaster
            position="bottom-right"
            richColors={false}
            toastOptions={{
              style: {
                background: 'var(--surface-elevated)',
                color: 'var(--foreground)',
                borderColor: 'var(--border)',
              },
            }}
          />
        </MotionConfig>
      </SWRConfig>
    </div>
  );
}
