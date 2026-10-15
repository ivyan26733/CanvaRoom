import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

dotenv.config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const environmentSchema = z.object({
  SERVER_HOST: z.string().min(1).default('127.0.0.1'),
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  // Vercel's Upstash integration provides REDIS_URL / KV_URL. Without one, the
  // server keeps boards in memory, which only suits a single local process.
  REDIS_URL: z.string().optional(),
  KV_URL: z.string().optional(),
  // Comma-separated TURN URLs plus credentials, for peers behind strict NATs.
  TURN_URLS: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
});

const parsed = environmentSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid server environment: ${parsed.error.message}`);
}

const env = parsed.data;

export const config = {
  serverHost: env.SERVER_HOST,
  serverPort: env.SERVER_PORT,
  redisUrl: env.REDIS_URL || env.KV_URL || undefined,
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ...(env.TURN_URLS
      ? [
          {
            urls: env.TURN_URLS.split(',').map((url) => url.trim()),
            username: env.TURN_USERNAME ?? '',
            credential: env.TURN_CREDENTIAL ?? '',
          },
        ]
      : []),
  ],
};
