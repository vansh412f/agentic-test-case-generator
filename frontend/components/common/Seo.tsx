import Head from 'next/head';

interface SeoProps {
  title: string;
  description: string;
  path: string;
  type?: 'website' | 'article';
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

export function Seo({
  title,
  description,
  path,
  type = 'website',
  jsonLd,
}: SeoProps) {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const canonical = `${siteUrl}${path}`;
  const schemas = jsonLd === undefined ? [] : Array.isArray(jsonLd) ? jsonLd : [jsonLd];

  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={`${siteUrl}/og-default.png`} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={`${siteUrl}/og-default.png`} />

      {schemas.map((schema, index) => (
        <script
          // JSON-LD is static, application-generated structured data.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
          key={index}
          type="application/ld+json"
        />
      ))}
    </Head>
  );
}
