import type { NextConfig } from 'next';

// In Vercel, the deployment-level rewrite routes /api directly to the Fastify
// service. Keep this local proxy for the standalone Next.js dev server.
const nextConfig: NextConfig = process.env.VERCEL
  ? {}
  : {
      async rewrites() {
        return [
          {
            source: '/api/:path*',
            destination: 'http://127.0.0.1:4000/api/:path*',
          },
        ];
      },
    };

export default nextConfig;
