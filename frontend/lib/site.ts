export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');

export interface SitemapPath {
  path: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
}

export const SITEMAP_PATHS: SitemapPath[] = [
  { path: '/', changefreq: 'weekly', priority: 1.0 },
  { path: '/limitations', changefreq: 'monthly', priority: 0.5 },
  { path: '/privacy', changefreq: 'monthly', priority: 0.3 },
];
