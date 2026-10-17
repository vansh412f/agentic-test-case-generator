import type { GetServerSideProps } from 'next';
import { SITE_URL } from '@/lib/site';

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const content = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.write(content);
  res.end();

  return { props: {} };
};

export default function Robots() {
  return null;
}
