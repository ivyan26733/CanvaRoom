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
  // Premium, per month, in each currency's smallest unit (paise, cents): the
  // price charged and an optional higher "was" price shown struck through.
  // Visitors in India pay in rupees; everyone else in dollars.
  BILLING_INR_PRICE_MINOR: z.coerce.number().int().min(100).default(49900),
  BILLING_INR_LIST_PRICE_MINOR: z.coerce.number().int().min(0).default(0),
  BILLING_USD_PRICE_MINOR: z.coerce.number().int().min(100).default(1199),
  BILLING_USD_LIST_PRICE_MINOR: z.coerce.number().int().min(0).default(1599),
  BILLING_PASS_DAYS: z.coerce.number().int().min(1).max(366).default(30),
  // Resend's API, replaceable with a local stand-in in tests.
  RESEND_API_URL: z.url().default('https://api.resend.com'),
  // Where feedback from the site is emailed.
  FEEDBACK_TO: z.email().default('ivyan26733@gmail.com'),
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
  resendApiUrl: env.RESEND_API_URL.replace(/\/$/, ''),
  razorpay:
    env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
      ? { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET }
      : undefined,
  prices: {
    INR: {
      amount: env.BILLING_INR_PRICE_MINOR,
      listAmount: env.BILLING_INR_LIST_PRICE_MINOR,
    },
    USD: {
      amount: env.BILLING_USD_PRICE_MINOR,
      listAmount: env.BILLING_USD_LIST_PRICE_MINOR,
    },
  },
  passDays: env.BILLING_PASS_DAYS,
  feedbackTo: env.FEEDBACK_TO,
  mailFrom: env.MAIL_FROM || 'CanvaRoom <onboarding@resend.dev>',
  // Resend's shared sender only delivers to the Resend account's own address,
  // so mail to customers (password reset) waits for a verified domain.
  mailDomainVerified: Boolean(env.MAIL_FROM),
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
