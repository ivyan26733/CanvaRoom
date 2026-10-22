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
  // Cloudflare Realtime (serverless SFU) for voice. The token never leaves
  // the server; without both, calls stay peer to peer.
  CF_REALTIME_APP_ID: z.string().optional(),
  CF_REALTIME_APP_TOKEN: z.string().optional(),
  // Email for password resets. Resend's sandbox sender only delivers to the
  // Resend account owner until a domain is verified and MAIL_FROM uses it.
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  // SMTP for mail to anyone (sign-up links, reset codes) without a domain:
  // a Gmail account with an App Password works. Preferred over Resend.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Public address used in emailed links. Never taken from request headers.
  APP_URL: z.url().optional(),
  // Razorpay Standard Checkout. The secret signs orders and payments and must
  // never reach the browser; the key ID is public.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  // Secret of the webhook set up in the Razorpay dashboard. Without it the
  // webhook route refuses every call.
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // PayPal Checkout for buyers outside India. PAYPAL_MODE picks the keys:
  // 'sandbox' (the default) uses the sandbox app and lets only the emails in
  // PAYPAL_SANDBOX_TESTERS pay; 'live' takes real money from everyone.
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_SANDBOX_CLIENT_ID: z.string().optional(),
  PAYPAL_SANDBOX_CLIENT_SECRET: z.string().optional(),
  PAYPAL_SANDBOX_TESTERS: z.string().optional(),
  // The ID of the webhook registered for the current mode. Without it the
  // PayPal webhook refuses every call.
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  // PayPal's API, replaceable with a local stand-in in tests.
  PAYPAL_API_URL: z.url().optional(),
  // Days a one-month order from before the 3/6/12-month plans still buys.
  // The plans themselves are in src/plans.ts.
  BILLING_PASS_DAYS: z.coerce.number().int().min(1).max(366).default(30),
  // Vercel sends it as a bearer token on cron requests. Without it the cron
  // routes refuse every call.
  CRON_SECRET: z.string().optional(),
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

/** The PayPal app for the current mode, when both its keys are set. */
function paypalConfig() {
  const live = env.PAYPAL_MODE === 'live';
  const clientId = (
    live ? env.PAYPAL_CLIENT_ID : env.PAYPAL_SANDBOX_CLIENT_ID
  )?.trim();
  const clientSecret = (
    live ? env.PAYPAL_CLIENT_SECRET : env.PAYPAL_SANDBOX_CLIENT_SECRET
  )?.trim();
  if (!clientId || !clientSecret) return undefined;
  return {
    mode: env.PAYPAL_MODE,
    clientId,
    clientSecret,
    webhookId: env.PAYPAL_WEBHOOK_ID?.trim() || undefined,
    apiUrl: env.PAYPAL_API_URL?.replace(/\/$/, ''),
    testers: new Set(
      (env.PAYPAL_SANDBOX_TESTERS ?? '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

export const config = {
  serverHost: env.SERVER_HOST,
  serverPort: env.SERVER_PORT,
  redisUrl: env.REDIS_URL || env.KV_URL || undefined,
  databaseUrl: env.DATABASE_URL || undefined,
  blobEnabled: Boolean(env.BLOB_READ_WRITE_TOKEN),
  resendApiKey: env.RESEND_API_KEY || undefined,
  smtp:
    env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS
      ? {
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
          from: env.SMTP_FROM || `CanvaRoom <${env.SMTP_USER}>`,
        }
      : undefined,
  resendApiUrl: env.RESEND_API_URL.replace(/\/$/, ''),
  razorpay:
    env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
      ? { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET }
      : undefined,
  paypal: paypalConfig(),
  razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET?.trim() || undefined,
  passDays: env.BILLING_PASS_DAYS,
  cronSecret: env.CRON_SECRET?.trim() || undefined,
  sfu:
    env.CF_REALTIME_APP_ID && env.CF_REALTIME_APP_TOKEN
      ? { appId: env.CF_REALTIME_APP_ID, token: env.CF_REALTIME_APP_TOKEN }
      : undefined,
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
