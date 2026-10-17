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
  // Neon Postgres holds accounts and boards. With it, Redis only carries the
  // live layer: presence, rate limits, and relaying between instances.
  DATABASE_URL: z.string().optional(),
  // Board images. Without a token they are kept on local disk (dev only).
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // Comma-separated TURN URLs plus credentials, for peers behind strict NATs.
  TURN_URLS: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
  // Email for password resets. Resend's sandbox sender only delivers to the
  // Resend account owner until a domain is verified and MAIL_FROM uses it.
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  // Public address used in emailed links. Never taken from request headers.
  APP_URL: z.url().optional(),
  // Razorpay Standard Checkout. The secret signs orders and payments and must
  // never reach the browser; the key ID is public.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  // The paid pass, in the currency's smallest unit (cents for USD): the price
  // charged, the higher "was" price shown struck through, and its length.
  BILLING_CURRENCY: z.string().length(3).toUpperCase().default('USD'),
  BILLING_PRICE_MINOR: z.coerce.number().int().min(100).default(1199),
  BILLING_LIST_PRICE_MINOR: z.coerce.number().int().min(0).default(1599),
  BILLING_PASS_DAYS: z.coerce.number().int().min(1).max(3660).default(30),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
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
  databaseUrl: env.DATABASE_URL || undefined,
  blobEnabled: Boolean(env.BLOB_READ_WRITE_TOKEN),
  resendApiKey: env.RESEND_API_KEY || undefined,
  razorpay:
    env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
      ? { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET }
      : undefined,
  pass: {
    name: `${env.BILLING_PASS_DAYS}-day pass`,
    amount: env.BILLING_PRICE_MINOR,
    listAmount: env.BILLING_LIST_PRICE_MINOR,
    currency: env.BILLING_CURRENCY,
    days: env.BILLING_PASS_DAYS,
  },
  mailFrom: env.MAIL_FROM || 'CanvaRoom <onboarding@resend.dev>',
  appUrl: (
    env.APP_URL ??
    (env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000')
  ).replace(/\/$/, ''),
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
