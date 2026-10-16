import type { MetadataRoute } from 'next';
import { SITE, USE_CASES } from './lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE.url, changeFrequency: 'weekly', priority: 1 },
    ...USE_CASES.map(({ slug }) => ({
      url: `${SITE.url}/${slug}`,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    { url: `${SITE.url}/about`, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
