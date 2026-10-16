import { Head, Html, Main, NextScript } from 'next/document';

const themeScript = `
(function () {
  try {
    var stored = window.localStorage.getItem('atsg-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
  } catch (error) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function Document() {
  const verification = process.env.NEXT_PUBLIC_GSC_VERIFICATION;

  return (
    <Html lang="en" suppressHydrationWarning>
      <Head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        {verification ? (
          <meta content={verification} name="google-site-verification" />
        ) : null}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
