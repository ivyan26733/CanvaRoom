import type { MetadataRoute } from 'next';
import { SITE } from './lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.name} — Online Whiteboard`,
    short_name: SITE.name,
    description: SITE.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f1ec',
    theme_color: '#ff4f1f',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
