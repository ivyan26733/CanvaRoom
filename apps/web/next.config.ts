import type { NextConfig } from 'next';

// Pages cannot be framed by other sites (so board controls cannot be
// clickjacked), and only this site may use the microphone.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), geolocation=(), microphone=(self), display-capture=(self)',
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // In Vercel, the deployment-level rewrite routes /api directly to the
  // Fastify service. Keep this local proxy for the standalone dev server.
  ...(process.env.VERCEL
    ? {}
    : {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: `${process.env.API_PROXY_URL ?? 'http://127.0.0.1:4000'}/api/:path*`,
            },
          ];
        },
      }),
};

export default nextConfig;
