import { Head, Html, Main, NextScript } from 'next/document';

export default function Document() {
  const verification = process.env.NEXT_PUBLIC_GSC_VERIFICATION;

  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        {verification ? (
          <meta content={verification} name="google-site-verification" />
        ) : null}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
