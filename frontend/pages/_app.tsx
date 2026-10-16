import type { AppProps } from 'next/app';
import { DM_Mono, Manrope } from 'next/font/google';
import Script from 'next/script';
import { SWRConfig } from 'swr';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { RouteFocusManager } from '@/components/layout/RouteFocusManager';
import { fetcher } from '@/lib/api';
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

export default function App({ Component, pageProps }: AppProps) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <div className={`${sans.variable} ${mono.variable} font-sans`}>
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
