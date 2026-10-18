import type { MetadataRoute } from 'next';
import { SITE } from './lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Boards and account pages are private to their members.
      disallow: [
        '/api/',
        '/board/',
        '/profile',
        '/reset-password',
        '/verify-email',
      ],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
