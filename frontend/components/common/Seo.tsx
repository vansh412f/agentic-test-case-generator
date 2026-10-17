import Head from 'next/head';
import { SITE_URL } from '@/lib/site';

interface SeoProps {
  title: string;
  description: string;
  path: string;
  type?: 'website' | 'article';
  image?: string;
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

export function Seo({
  title,
  description,
  path,
  type = 'website',
  image = '/og-default.png',
  noindex = false,
  jsonLd,
}: SeoProps) {
  const canonical = `${SITE_URL}${path}`;
  const imageUrl = image.startsWith('http://') || image.startsWith('https://')
    ? image
    : `${SITE_URL}${image.startsWith('/') ? '' : '/'}${image}`;
  const schemas = jsonLd === undefined ? [] : Array.isArray(jsonLd) ? jsonLd : [jsonLd];

  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      {noindex && <meta name="robots" content="noindex, follow" />}

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />

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
