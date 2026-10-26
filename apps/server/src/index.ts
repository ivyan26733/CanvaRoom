import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { waitUntil } from '@vercel/functions';
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import {
  currentSessionKey,
  decoyPasswordHash,
  endSession,
  hashPassword,
  PROFILE_COLORS,
  publicUser,
  sameOrigin,
  startSession,
  userFromRequest,
  verifyPassword,
} from './auth.js';
import {
  boardTier,
  canEdit,
  editBlockedReason,
  openToOthers,
  premiumUnlocked,
  publicBoard,
} from './boards.js';
import {
  createOrder,
  ORDER_ID,
  orderCapture,
  PAYMENT_ID,
  RazorpayError,
  validPaymentSignature,
  validWebhookSignature,
  webhookCapture,
  webhookRefund,
} from './billing.js';
import {
  captureOfOrder,
  capturePayPalOrder,
  createPayPalOrder,
  getPayPalOrder,
  PAYPAL_ID,
  paypalAllowedFor,
  PayPalError,
  readPayPalEvent,
  verifyPayPalWebhook,
} from './paypal.js';
import {
  mailConfigured,
  sendEmailVerification,
  sendFeedback,
  sendPasswordResetCode,
  sendPremiumReminder,
  sendPremiumWelcome,
  teamMailConfigured,
} from './mail.js';
import {
  attachRealtime,
  broadcast,
  broadcastBoard,
  refreshOwnerPlan,
} from './realtime.js';
import { loadStore, storageKind, store } from './store.js';
import {
  closeTracks,
  publish,
  pull,
  renegotiate,
  SfuError,
  sessionToken,
  sfuConfigured,
  validSessionToken,
} from './sfu.js';
import {
  copyImages,
  deleteImages,
  MAX_IMAGE_BYTES,
  readImage,
  saveImage,
  sniffImage,
} from './images.js';
import { applyPayment, sendRenewalReminders } from './payments.js';
import { checkoutFor } from './checkout.js';
import { PostgresStore } from './pg-store.js';
import {
  currencyForCountry,
  PLAN_IDS,
  planById,
  plansFor,
  termOfPlan,
  type PremiumPlan,
} from './plans.js';
import { pageIdSchema, pageNameSchema } from './schemas.js';
import { TEMPLATES, templateObjects } from './templates.js';
import {
  DEFAULT_PAGES,
  FREE_BOARDS,
  pageOf,
  providerOf,
  planOf,
  tierOf,
  TRIAL_BOARDS,
  TRIAL_GUESTS,
} from './models.js';
import type {
  Account,
  BoardMeta,
  BoardObject,
  Capture,
  CaptureResult,
  Operation,
  Page,
  Snapshot,
  User,
} from './models.js';

const app = Fastify({ logger: true, bodyLimit: 1_000_000 });

/** Run mail delivery after the HTTP response while the Vercel invocation remains active. */
function sendMailInBackground(
  task: Promise<void>,
  request: FastifyRequest,
  label: string,
) {
  runInBackground(task.catch((error) => request.log.error(error, label)));
}

/** Keeps the function alive on Vercel until `task`, which must not reject, ends. */
function runInBackground(task: Promise<void>) {
  if (process.env.VERCEL) waitUntil(task);
  else void task;
}

attachRealtime(app.server);
// Image uploads arrive as raw bytes; their type is checked from the content.
app.addContentTypeParser(
  ['image/png', 'image/jpeg', 'image/webp'],
  { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES },
  (_request, body, done) => done(null, body),
);

const apiError = (
  reply: FastifyReply,
  status: number,
  message: string,
  code?: string,
) => reply.code(status).send({ error: message, ...(code ? { code } : {}) });
/** The page opens the upgrade dialog on a 402 with this code. */
const paymentRequired = (reply: FastifyReply, message: string) =>
  apiError(reply, 402, message, 'payment_required');
/**
 * Checks the account may own one more board: two on the trial, one on the
 * free plan, any number on Premium. Replies 402 and returns undefined when
 * not; otherwise returns how many boards it owns now.
 */
const boardSlot = async (user: User, reply: FastifyReply) => {
  const tier = tierOf(user.plan);
  const owned = (await store.listBoards(user.id)).filter(
    (board) => board.role === 'owner',
  ).length;
  if (tier === 'premium') return owned;
  const limit = tier === 'trial' ? TRIAL_BOARDS : FREE_BOARDS;
  if (owned < limit) return owned;
  paymentRequired(
    reply,
    tier === 'trial'
      ? `The free trial includes ${TRIAL_BOARDS} boards. Upgrade to Premium for unlimited boards.`
      : 'Your free trial has ended, and the free plan keeps one board. Upgrade to Premium for unlimited boards.',
  );
};
const currentUser = async (request: FastifyRequest, reply: FastifyReply) => {
  const user = await userFromRequest(request.raw);
  if (!user) {
    apiError(reply, 401, 'Please sign in to continue.');
    return;
  }
  return user;
};
const clientIp = (request: FastifyRequest) =>
  (request.headers['x-forwarded-for'] as string | undefined)
    ?.split(',')[0]
    ?.trim() ?? request.ip;
/** Fixed-window limit; replies 429 and returns false once exceeded. */
const allow = async (
  reply: FastifyReply,
  key: string,
  limit: number,
  windowSeconds: number,
) => {
  if ((await store.hit(key, windowSeconds)) <= limit) return true;
  apiError(
    reply,
    429,
    'Too many attempts. Please wait a few minutes and try again.',
  );
  return false;
};
const nameSchema = z.string().trim().min(1, 'Enter your name.').max(48);
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.').max(254));
const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters for your password.')
  .max(200);
const colorFor = (id: string) => {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PROFILE_COLORS[Math.abs(hash) % PROFILE_COLORS.length]!;
};
const firstIssue = (error: z.ZodError) =>
  error.issues[0]?.message ?? 'Check the form and try again.';
const getAccess = async (boardId: string, userId: string) => {
  const board = await store.getMeta(boardId);
  const membership = board?.members[userId];
  return board && membership ? { board, role: membership.role } : undefined;
};
const inviteId = () => randomBytes(24).toString('base64url');
const ADMIN_COOKIE = 'cb_admin_session';
const ADMIN_SESSION_TTL = 60 * 60 * 8;
const adminStore = store instanceof PostgresStore ? store : undefined;
const adminSessionKey = (token: string) =>
  createHash('sha256').update(`admin:${token}`).digest('base64url');
const readAdminCookie = (header: string | undefined) => {
  for (const part of header?.split(';') ?? []) {
    const [name, ...value] = part.trim().split('=');
    if (name === ADMIN_COOKIE) return value.join('=');
  }
};
async function adminFromRequest(request: FastifyRequest) {
  const token = readAdminCookie(request.headers.cookie);
  if (!adminStore) return undefined;
  if (token) {
    const username = await adminStore.getAdminSession(adminSessionKey(token));
    if (username) {
      const account = await store.findAccountByEmail(username);
      if (account?.role === 'admin') return account.email;
    }
  }

  // The site's regular account session already proves the person signed in.
  // Let admin accounts use that session in the console too, so opening the
  // Admin panel from the dashboard does not ask for a second set of creds.
  const user = await userFromRequest(request.raw);
  return user && !user.guest && user.role === 'admin'
    ? user.email
    : undefined;
}
const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
  const username = await adminFromRequest(request);
  if (username) return username;
  apiError(reply, 401, 'Admin sign-in required.');
};
/**
 * The signed-in user and their access to the board in the URL. The board is
 * read alongside the session rather than after it, saving a database round
 * trip on read-only routes. Replies 401/404 itself when either is missing.
 */
const readAccess = async (
  request: FastifyRequest,
  reply: FastifyReply,
  notFound: string,
) => {
  const { boardId } = request.params as { boardId: string };
  const [user, board] = await Promise.all([
    currentUser(request, reply),
    store.getMeta(boardId),
  ]);
  if (!user) return;
  const membership = board?.members[user.id];
  if (!board || !membership) {
    apiError(reply, 404, notFound);
    return;
  }
  return { user, board, role: membership.role };
};

app.addHook('onRequest', async (request, reply) => {
  reply
    .header('Cache-Control', 'no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'strict-origin-when-cross-origin');
  // The session is a cookie, so refuse writes started by other websites.
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    !sameOrigin(request.raw)
  )
    return apiError(reply, 403, 'Cross-site request blocked.');
});

// ---- Admin console ----

app.get('/api/admin/me', async (request) => {
  const username = await adminFromRequest(request);
  return {
    authenticated: Boolean(username),
    username,
    configured: Boolean(adminStore),
  };
});

app.post('/api/admin/login', async (request, reply) => {
  if (!adminStore)
    return apiError(
      reply,
      503,
      'Admin sign-in requires the Postgres database.',
    );
  if (!(await allow(reply, `admin-login:${clientIp(request)}`, 8, 900))) return;
  const body = z
    .object({
      username: emailSchema,
      password: z.string().min(1).max(256),
    })
    .safeParse(request.body);
  if (!body.success)
    return apiError(reply, 400, 'Enter the admin email and password.');
  const account = await store.findAccountByEmail(body.data.username);
  const valid = await verifyPassword(
    body.data.password,
    account?.passwordHash ?? (await decoyPasswordHash()),
  );
  if (!account || account.role !== 'admin' || !valid)
    return apiError(
      reply,
      401,
      'That admin email and password do not match.',
    );
  const username = account.email;
  const token = randomBytes(32).toString('base64url');
  await adminStore.createAdminSession(
    adminSessionKey(token),
    username,
    ADMIN_SESSION_TTL,
  );
  const forwarded = request.headers['x-forwarded-proto'];
  const secure =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0] ===
      'https' ||
    Boolean((request.raw.socket as { encrypted?: boolean }).encrypted);
  reply.header(
    'Set-Cookie',
    [
      `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${ADMIN_SESSION_TTL}`,
      ...(secure ? ['Secure'] : []),
    ].join('; '),
  );
  return { authenticated: true, username };
});

app.post('/api/admin/logout', async (request, reply) => {
  const token = readAdminCookie(request.headers.cookie);
  if (token && adminStore)
    await adminStore.deleteAdminSession(adminSessionKey(token));
  reply.header(
    'Set-Cookie',
    `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
  );
  return { authenticated: false };
});

app.get('/api/admin/users', async (request, reply) => {
  const username = await requireAdmin(request, reply);
  if (!username || !adminStore) return;
  const query = z
    .object({
      q: z.string().trim().max(200).default(''),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    })
    .safeParse(request.query);
  if (!query.success) return apiError(reply, 400, 'Invalid user-list request.');
  return adminStore.listAdminAccounts(
    query.data.q,
    query.data.limit,
    (query.data.page - 1) * query.data.limit,
  );
});

app.post('/api/admin/users/:userId/grants', async (request, reply) => {
  const username = await requireAdmin(request, reply);
  if (!username || !adminStore) return;
  const { userId } = request.params as { userId: string };
  const body = z
    .object({
      months: z.number().int().min(0).max(120),
      days: z.number().int().min(0).max(365),
      method: z.enum(['cash', 'bank_transfer', 'complimentary', 'other']),
      reference: z
        .string()
        .trim()
        .max(120)
        .optional()
        .transform((value) => value || undefined),
      note: z
        .string()
        .trim()
        .max(500)
        .optional()
        .transform((value) => value || undefined),
    })
    .refine((value) => value.months > 0 || value.days > 0, {
      message: 'Choose a Premium duration greater than zero.',
    })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  const paidUntil = await adminStore.grantAdminAccess({
    id: randomUUID(),
    username,
    userId,
    months: body.data.months,
    days: body.data.days,
    method: body.data.method,
    ...(body.data.reference ? { reference: body.data.reference } : {}),
    ...(body.data.note ? { note: body.data.note } : {}),
  });
  if (!paidUntil)
    return apiError(reply, 404, 'No account exists with that user ID.');
  const account = await store.getAccount(userId);
  if (account) refreshOwnerPlan(userId, planOf({ ...account, paidUntil }));
  return { ok: true, paidUntil };
});

app.get('/api/admin/bank-transfers', async (request, reply) => {
  const username = await requireAdmin(request, reply);
  if (!username || !adminStore) return;
  if (config.usdBankTransferPreviewOnly) return { transfers: [] };
  return { transfers: await adminStore.listAdminBankTransfers() };
});

app.post('/api/admin/bank-transfers/:id/confirm', async (request, reply) => {
  const username = await requireAdmin(request, reply);
  if (!username || !adminStore) return;
  if (config.usdBankTransferPreviewOnly)
    return apiError(reply, 503, 'Bank transfer review is disabled in Preview.');
  const { id } = request.params as { id: string };
  const result = await adminStore.confirmBankTransfer(
    id,
    username,
    randomUUID(),
  );
  if (result.outcome === 'unknown')
    return apiError(reply, 404, 'Bank transfer request not found.');
  if (result.outcome === 'not_pending')
    return apiError(reply, 409, 'This bank transfer is no longer pending.');
  if (result.outcome === 'confirmed') {
    const account = await store.getAccount(result.userId);
    if (account)
      refreshOwnerPlan(
        result.userId,
        planOf({ ...account, paidUntil: result.paidUntil }),
      );
  }
  return result;
});

app.post('/api/admin/bank-transfers/:id/reject', async (request, reply) => {
  const username = await requireAdmin(request, reply);
  if (!username || !adminStore) return;
  if (config.usdBankTransferPreviewOnly)
    return apiError(reply, 503, 'Bank transfer review is disabled in Preview.');
  const { id } = request.params as { id: string };
  const result = await adminStore.rejectBankTransfer(id, username);
  if (result.outcome === 'unknown')
    return apiError(reply, 404, 'Bank transfer request not found.');
  if (result.outcome === 'not_pending')
    return apiError(reply, 409, 'This bank transfer is no longer pending.');
  return result;
});

// ---- Accounts ----

app.get('/api/auth/me', async (request) => ({
  user: (await userFromRequest(request.raw)) ?? null,
}));

app.post('/api/auth/signup', async (request, reply) => {
  const body = z
    .object({ name: nameSchema, email: emailSchema, password: passwordSchema })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  if (!(await allow(reply, `signup:${clientIp(request)}`, 10, 3600))) return;
  // A guest who signs up keeps the boards they already joined.
  const current = await userFromRequest(request.raw);
  const id = current?.guest ? current.id : randomUUID();
  const account: Account = {
    id,
    email: body.data.email,
    name: body.data.name,
    color: current?.color ?? colorFor(id),
    createdAt: new Date().toISOString(),
    passwordHash: await hashPassword(body.data.password),
    // Unverified until they enter the emailed code. Without mail nothing is
    // sent, nothing is blocked, and the code can be asked for once it works.
    emailVerified: false,
    trialUsedSeconds: 0,
  };
  if (!(await store.createAccount(account)))
    return apiError(
      reply,
      409,
      'An account with this email already exists. Sign in instead.',
    );
  if (current?.guest) {
    await renameEverywhere(publicUser(account));
    const guestSession = currentSessionKey(request.raw);
    if (guestSession) await store.deleteSession(guestSession);
  }
  await startSession(request, reply, publicUser(account));
  if (mailConfigured()) await sendVerificationCode(account, request);
  return reply.code(201).send({ user: publicUser(account) });
});

app.post('/api/auth/login', async (request, reply) => {
  const body = z
    .object({ email: emailSchema, password: z.string().min(1).max(200) })
    .safeParse(request.body);
  if (!body.success)
    return apiError(reply, 400, 'Enter your email and password.');
  if (
    !(await allow(reply, `login-ip:${clientIp(request)}`, 30, 900)) ||
    !(await allow(reply, `login:${body.data.email}`, 8, 900))
  )
    return;
  const account = await store.findAccountByEmail(body.data.email);
  const valid = await verifyPassword(
    body.data.password,
    account?.passwordHash ?? (await decoyPasswordHash()),
  );
  if (!account || !valid)
    return apiError(reply, 401, 'That email and password don’t match.');
  await startSession(request, reply, publicUser(account));
  return { user: publicUser(account) };
});

app.post('/api/auth/guest', async (request, reply) => {
  const body = z.object({ name: nameSchema }).safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  if (!(await allow(reply, `guest:${clientIp(request)}`, 30, 3600))) return;
  const id = randomUUID();
  const user: User = {
    id,
    name: body.data.name,
    color: colorFor(id),
    guest: true,
  };
  await startSession(request, reply, user);
  return reply.code(201).send({ user });
});

app.post('/api/auth/logout', async (request, reply) => {
  await endSession(request, reply);
  return { ok: true };
});

// ---- Password reset ----

const RESET_CODE_MINUTES = 10;
const RESET_CODE_ATTEMPTS = 5;
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('base64url');
/** Reset codes are short, so each is stored hashed together with its account. */
const resetCodeKey = (userId: string, code: string) =>
  hashToken(`reset-code:${userId}:${code}`);
const SUPPORT_EMAIL = 'canvacollabroom@gmail.com';

app.post('/api/auth/forgot', async (request, reply) => {
  const body = z.object({ email: emailSchema }).safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  // Local development without email prints the code to the server log.
  const printCode = !mailConfigured() && !process.env.VERCEL;
  if (!mailConfigured() && !printCode)
    return apiError(
      reply,
      503,
      `Password reset email isn’t available yet. Email ${SUPPORT_EMAIL} and we’ll help you back in.`,
    );
  if (
    !(await allow(reply, `forgot-ip:${clientIp(request)}`, 10, 3600)) ||
    !(await allow(reply, `forgot:${body.data.email}`, 3, 3600))
  )
    return;
  const account = await store.findAccountByEmail(body.data.email);
  // The reply is the same whether or not the account exists.
  if (account) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    // A new code replaces any earlier one.
    await store.createResetToken(
      resetCodeKey(account.id, code),
      account.id,
      RESET_CODE_MINUTES * 60,
    );
    if (printCode) request.log.warn({ code }, 'Password reset code (dev)');
    else
      sendMailInBackground(
        sendPasswordResetCode(
          account.email,
          account.name,
          code,
          RESET_CODE_MINUTES,
        ),
        request,
        'Password reset email failed',
      );
  }
  return {
    ok: true,
    message: `If an account uses that email, we’ve sent it a 6-digit code. It works for ${RESET_CODE_MINUTES} minutes. Check your inbox and spam folder.`,
  };
});

app.post('/api/auth/reset', async (request, reply) => {
  const body = z
    .object({
      email: emailSchema,
      code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
      password: passwordSchema,
    })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  if (!(await allow(reply, `reset-ip:${clientIp(request)}`, 20, 900))) return;
  const account = await store.findAccountByEmail(body.data.email);
  // A few guesses per code: past that, the code is thrown away.
  const attempts = await store.hit(
    `reset-code:${body.data.email}`,
    RESET_CODE_MINUTES * 60,
  );
  if (attempts > RESET_CODE_ATTEMPTS) {
    if (account)
      await store.createResetToken(
        hashToken(randomBytes(32).toString('base64url')),
        account.id,
        1,
      );
    return apiError(
      reply,
      429,
      'Too many wrong codes. Request a new code in a few minutes.',
    );
  }
  const passwordHash = await hashPassword(body.data.password);
  const userId = account
    ? await store.completePasswordReset(
        resetCodeKey(account.id, body.data.code),
        passwordHash,
      )
    : undefined;
  const updated = userId ? await store.getAccount(userId) : undefined;
  if (!updated)
    return apiError(
      reply,
      400,
      'That code is wrong or has expired. Check the email or request a new code.',
    );
  await startSession(request, reply, publicUser(updated));
  return { user: publicUser(updated) };
});

// ---- Email verification ----

const VERIFY_CODE_MINUTES = 10;
const VERIFY_CODE_ATTEMPTS = 5;
const verifyCodeKey = (userId: string, code: string) =>
  hashToken(`verify-code:${userId}:${code}`);

/** Emails a fresh 6-digit code, replacing any earlier one. */
async function sendVerificationCode(account: Account, request: FastifyRequest) {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  await store.createVerificationToken(
    verifyCodeKey(account.id, code),
    account.id,
    VERIFY_CODE_MINUTES * 60,
  );
  if (!mailConfigured() && !process.env.VERCEL)
    request.log.warn({ code }, 'Email verification code (dev)');
  else
    sendMailInBackground(
      sendEmailVerification(
        account.email,
        account.name,
        code,
        VERIFY_CODE_MINUTES,
      ),
      request,
      'Verification email failed',
    );
}

/** The signed-in account that still needs to verify, or a reply saying why not. */
async function unverifiedAccount(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentUser(request, reply);
  if (!user) return;
  if (user.guest) {
    apiError(reply, 403, 'Create an account first.');
    return;
  }
  const account = await store.getAccount(user.id);
  if (!account) {
    apiError(reply, 401, 'Please sign in again.');
    return;
  }
  return account;
}

app.post('/api/auth/verify-email', async (request, reply) => {
  const body = z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
    })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  const account = await unverifiedAccount(request, reply);
  if (!account) return;
  if (account.emailVerified !== false) return { user: publicUser(account) };
  const attempts = await store.hit(
    `verify-code:${account.id}`,
    VERIFY_CODE_MINUTES * 60,
  );
  if (attempts > VERIFY_CODE_ATTEMPTS) {
    // Too many guesses: the code is thrown away.
    await store.createVerificationToken(
      hashToken(randomBytes(32).toString('base64url')),
      account.id,
      1,
    );
    return apiError(
      reply,
      429,
      'Too many wrong codes. Send yourself a new code and try again.',
    );
  }
  const userId = await store.verifyEmailToken(
    verifyCodeKey(account.id, body.data.code),
  );
  const verified = userId ? await store.getAccount(userId) : undefined;
  if (!verified)
    return apiError(
      reply,
      400,
      'That code is wrong or has expired. Check the email or send a new code.',
    );
  return { user: publicUser(verified) };
});

const RESEND_COOLDOWN_SECONDS = 60;

app.post('/api/auth/resend-verification', async (request, reply) => {
  if (!mailConfigured())
    return apiError(
      reply,
      503,
      `Email isn’t available right now. Email ${SUPPORT_EMAIL} for help.`,
    );
  const account = await unverifiedAccount(request, reply);
  if (!account) return;
  if (account.emailVerified !== false) return { ok: true, cooldown: 0 };
  if (
    (await store.hit(`verify-cool:${account.id}`, RESEND_COOLDOWN_SECONDS)) > 1
  )
    return apiError(
      reply,
      429,
      'A code is already on its way. You can ask for another in a minute.',
    );
  if (!(await allow(reply, `verify-send:${account.id}`, 6, 3600))) return;
  await sendVerificationCode(account, request);
  return {
    ok: true,
    cooldown: RESEND_COOLDOWN_SECONDS,
    message: `We’ve sent a new code to ${account.email}. Check your inbox and spam folder.`,
  };
});

app.post('/api/auth/change-email', async (request, reply) => {
  const body = z.object({ email: emailSchema }).safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  const account = await unverifiedAccount(request, reply);
  if (!account) return;
  if (account.emailVerified !== false)
    return apiError(reply, 400, 'Your email is already verified.');
  if (!(await allow(reply, `change-email:${account.id}`, 5, 3600))) return;
  if (!(await store.changeEmail(account.id, body.data.email)))
    return apiError(
      reply,
      409,
      'An account with this email already exists. Sign in instead.',
    );
  const updated = { ...account, email: body.data.email };
  await renameEverywhere(publicUser(updated));
  if (mailConfigured()) await sendVerificationCode(updated, request);
  return { user: publicUser(updated) };
});

/** Keeps a person's name and colour current on every board they belong to. */
async function renameEverywhere(user: User) {
  for (const boardId of await store.boardIdsFor(user.id)) {
    const board = await store.getMeta(boardId);
    const member = board?.members[user.id];
    if (!board || !member || member.name === user.name) continue;
    const updated = { ...member, name: user.name };
    await store.setMember(boardId, user.id, updated);
    broadcastBoard({
      ...board,
      members: { ...board.members, [user.id]: updated },
    });
  }
}

app.get('/api/profile', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  if (user.guest) return apiError(reply, 403, 'Guests do not have a profile.');
  const account = await store.getAccount(user.id);
  const boards = await store.listBoards(user.id);
  return {
    user,
    createdAt: account?.createdAt,
    stats: {
      boards: boards.length,
      owned: boards.filter((board) => board.role === 'owner').length,
    },
    colors: PROFILE_COLORS,
  };
});

app.patch('/api/profile', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  if (user.guest) return apiError(reply, 403, 'Create an account first.');
  const body = z
    .object({
      name: nameSchema.optional(),
      color: z.enum(PROFILE_COLORS as [string, ...string[]]).optional(),
    })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  const fields = {
    ...(body.data.name ? { name: body.data.name } : {}),
    ...(body.data.color ? { color: body.data.color } : {}),
  };
  await store.updateAccount(user.id, fields);
  const updated = { ...user, ...fields };
  if (fields.name) await renameEverywhere(updated);
  return { user: updated };
});

app.post('/api/profile/password', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  if (user.guest) return apiError(reply, 403, 'Create an account first.');
  const body = z
    .object({
      currentPassword: z.string().min(1).max(200),
      newPassword: passwordSchema,
    })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  if (!(await allow(reply, `password:${user.id}`, 8, 900))) return;
  const account = await store.getAccount(user.id);
  if (
    !account ||
    !(await verifyPassword(body.data.currentPassword, account.passwordHash))
  )
    return apiError(reply, 400, 'Your current password is incorrect.');
  await store.updateAccount(user.id, {
    passwordHash: await hashPassword(body.data.newPassword),
  });
  // Sign out everywhere else, in case the old password was compromised.
  await store.deleteSessionsFor(user.id, currentSessionKey(request.raw));
  return { ok: true };
});

// ---- Boards ----

app.get('/api/boards', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  return store.listBoards(user.id);
});

app.post('/api/boards', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const body = z
    .object({
      title: z.string().trim().min(1).max(80),
      template: z.enum(TEMPLATES).optional(),
    })
    .safeParse(request.body);
  if (user.guest)
    return apiError(
      reply,
      403,
      'Create a free account to make your own boards.',
    );
  if (!body.success)
    return apiError(reply, 400, 'Board name must be 1–80 characters.');
  const owned = await boardSlot(user, reply);
  if (owned === undefined) return;
  const now = new Date().toISOString();
  const board: BoardMeta = {
    id: randomUUID(),
    title: body.data.title,
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
    locked: false,
    members: { [user.id]: { role: 'owner', name: user.name } },
    inviteToken: inviteId(),
    inviteRevoked: false,
    pages: DEFAULT_PAGES,
    ...(user.plan ? { ownerPlan: user.plan } : {}),
    ownerFirstBoard: owned === 0,
  };
  await store.createBoard(
    board,
    templateObjects(body.data.template ?? 'blank'),
  );
  return reply.code(201).send(publicBoard(board, 'owner'));
});

app.get('/api/boards/:boardId', async (request, reply) => {
  const access = await readAccess(
    request,
    reply,
    'Board not found or you do not have access.',
  );
  if (!access) return;
  return publicBoard(access.board, access.role);
});

app.patch('/api/boards/:boardId', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const body = z
    .object({
      title: z.string().trim().min(1).max(80).optional(),
      locked: z.boolean().optional(),
    })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, 'Invalid board update.');
  const access = await getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  if (access.role !== 'owner')
    return apiError(
      reply,
      403,
      'Only the board owner can change these settings.',
    );
  const fields = {
    ...(body.data.title !== undefined ? { title: body.data.title } : {}),
    ...(body.data.locked !== undefined ? { locked: body.data.locked } : {}),
    updatedAt: new Date().toISOString(),
  };
  await store.updateMeta(boardId, fields);
  const board = { ...access.board, ...fields };
  broadcastBoard(board);
  return publicBoard(board, access.role);
});

app.delete('/api/boards/:boardId', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = await getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  if (access.role !== 'owner')
    return apiError(reply, 403, 'Only the board owner can delete this board.');
  await store.deleteBoard(boardId);
  broadcast(boardId, { t: 'deleted' });
  await deleteImages(boardId).catch((error: unknown) =>
    request.log.error(error, 'Could not delete board images'),
  );
  return reply.code(204).send();
});

app.post('/api/boards/:boardId/duplicate', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const source = await getAccess(boardId, user.id);
  if (!source) return apiError(reply, 404, 'Board not found.');
  if (user.guest)
    return apiError(reply, 403, 'Create a free account to duplicate boards.');
  if (source.role === 'viewer')
    return apiError(reply, 403, 'Viewers cannot duplicate this board.');
  const owned = await boardSlot(user, reply);
  if (owned === undefined) return;
  const now = new Date().toISOString();
  const duplicate: BoardMeta = {
    id: randomUUID(),
    title: `${source.board.title} copy`.slice(0, 80),
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
    locked: false,
    members: { [user.id]: { role: 'owner', name: user.name } },
    inviteToken: inviteId(),
    inviteRevoked: false,
    pages: source.board.pages,
    ...(user.plan ? { ownerPlan: user.plan } : {}),
    ownerFirstBoard: owned === 0,
  };
  const objects = await copyImages(
    boardId,
    duplicate.id,
    await store.getObjects(boardId),
  );
  await store.createBoard(duplicate, objects);
  return reply.code(201).send(publicBoard(duplicate, 'owner'));
});

// ---- Images ----

app.post('/api/boards/:boardId/images', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = await getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  if (!canEdit(access.role, access.board))
    return apiError(reply, 403, editBlockedReason(access.role, access.board));
  if (!premiumUnlocked(access.board, user))
    return paymentRequired(
      reply,
      'Adding images is a Premium feature. Upgrade to add images to your boards.',
    );
  const bytes = request.body;
  const type = Buffer.isBuffer(bytes) ? sniffImage(bytes) : undefined;
  if (!type) return apiError(reply, 415, 'Choose a PNG, JPEG, or WebP image.');
  if (!(await allow(reply, `upload:${user.id}`, 60, 600))) return;
  try {
    return reply
      .code(201)
      .send({ src: await saveImage(boardId, bytes as Buffer, type) });
  } catch (error) {
    request.log.error(error, 'Image upload failed');
    return apiError(reply, 503, 'Images cannot be uploaded right now.');
  }
});

app.get('/api/boards/:boardId/images/:name', async (request, reply) => {
  const { boardId, name } = request.params as { boardId: string; name: string };
  if (!(await readAccess(request, reply, 'Image not found.'))) return;
  const image = await readImage(boardId, name);
  if (!image) return apiError(reply, 404, 'Image not found.');
  // Names are never reused, so the browser can keep its copy.
  return (
    reply
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      // Uploaded bytes are only ever shown as images, never run as a page,
      // and only this site may embed them.
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('Content-Disposition', `inline; filename="${name}"`)
      .type(image.contentType)
      .send(image.body)
  );
});

app.post('/api/boards/:boardId/join', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const body = z
    .object({ inviteToken: z.string().min(1) })
    .safeParse(request.body);
  const board = await store.getMeta(boardId);
  if (!board) return apiError(reply, 404, 'This board no longer exists.');
  const existing = board.members[user.id];
  if (existing) return publicBoard(board, existing.role);
  if (
    !body.success ||
    board.inviteRevoked ||
    body.data.inviteToken !== board.inviteToken
  )
    return apiError(reply, 404, 'This invite is invalid or has been revoked.');
  if (!openToOthers(board))
    return apiError(
      reply,
      403,
      'This board isn’t taking new people right now. Ask its owner to upgrade.',
      'owner_payment_required',
    );
  // The trial lets two people besides the owner in.
  if (
    boardTier(board) === 'trial' &&
    Object.keys(board.members).filter((id) => id !== board.ownerId).length >=
      TRIAL_GUESTS
  )
    return apiError(
      reply,
      403,
      `This board is full on the free plan: it can have ${TRIAL_GUESTS} people besides its owner. Ask the owner to upgrade to Premium.`,
      'board_full',
    );
  const member = { role: 'editor' as const, name: user.name };
  await store.setMember(boardId, user.id, member);
  const next = { ...board, members: { ...board.members, [user.id]: member } };
  broadcastBoard(next);
  return publicBoard(next, 'editor');
});

app.post('/api/boards/:boardId/invites/regenerate', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = await getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  if (access.role !== 'owner')
    return apiError(reply, 403, 'Only the owner can manage invites.');
  if (!openToOthers(access.board))
    return paymentRequired(
      reply,
      'Your free trial has ended. Upgrade to Premium to invite people.',
    );
  const inviteToken = inviteId();
  await store.updateMeta(boardId, { inviteToken, inviteRevoked: false });
  return { inviteToken };
});

app.delete('/api/boards/:boardId/invites', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = await getAccess(boardId, user.id);
  if (!access || access.role !== 'owner')
    return apiError(reply, 403, 'Only the owner can manage invites.');
  await store.updateMeta(boardId, { inviteRevoked: true });
  return reply.code(204).send();
});

app.patch('/api/boards/:boardId/members/:memberId', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const { boardId, memberId } = request.params as {
    boardId: string;
    memberId: string;
  };
  const body = z
    .object({ role: z.enum(['editor', 'viewer']) })
    .safeParse(request.body);
  const access = await getAccess(boardId, user.id);
  if (!access || access.role !== 'owner')
    return apiError(reply, 403, 'Only the owner can change member roles.');
  const member = access.board.members[memberId];
  if (!body.success || memberId === access.board.ownerId || !member)
    return apiError(reply, 400, 'Invalid member role update.');
  const updated = { ...member, role: body.data.role };
  await store.setMember(boardId, memberId, updated);
  broadcastBoard({
    ...access.board,
    members: { ...access.board.members, [memberId]: updated },
  });
  return { ok: true };
});

app.get('/api/boards/:boardId/snapshots', async (request, reply) => {
  const { boardId } = request.params as { boardId: string };
  const [access, snapshots] = await Promise.all([
    readAccess(request, reply, 'Board not found.'),
    store.listSnapshots
      ? store.listSnapshots(boardId)
      : store.getSnapshots(boardId),
  ]);
  if (!access) return;
  return snapshots.map(({ id, title, createdAt }) => ({
    id,
    title,
    createdAt,
  }));
});

app.post('/api/boards/:boardId/snapshots', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = await getAccess(boardId, user.id);
  if (!access || access.role === 'viewer')
    return apiError(reply, 403, 'You cannot create a snapshot.');
  const snapshot: Snapshot = {
    id: randomUUID(),
    title: access.board.title,
    createdAt: new Date().toISOString(),
    objects: await store.getObjects(boardId),
    pages: access.board.pages,
  };
  await store.addSnapshot(boardId, snapshot);
  return reply.code(201).send({
    id: snapshot.id,
    title: snapshot.title,
    createdAt: snapshot.createdAt,
  });
});

app.post(
  '/api/boards/:boardId/snapshots/:snapshotId/restore',
  async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return;
    const { boardId, snapshotId } = request.params as {
      boardId: string;
      snapshotId: string;
    };
    const access = await getAccess(boardId, user.id);
    if (!access || access.role !== 'owner')
      return apiError(reply, 403, 'Only the owner can restore a snapshot.');
    if (!canEdit('owner', { ...access.board, locked: false }))
      return paymentRequired(
        reply,
        editBlockedReason('owner', { ...access.board, locked: false }),
      );
    const snapshot = (await store.getSnapshots(boardId)).find(
      (item) => item.id === snapshotId,
    );
    if (!snapshot) return apiError(reply, 404, 'Snapshot not found.');
    // Fresh IDs keep late edits to the replaced objects from resurrecting them.
    const objects: BoardObject[] = snapshot.objects.map((object) => ({
      ...object,
      id: randomUUID(),
    }));
    const pages = snapshot.pages ?? access.board.pages;
    await store.replaceObjects(boardId, objects);
    await store.updateMeta(boardId, { pages });
    broadcastBoard({ ...access.board, pages });
    broadcast(boardId, { t: 'reset', objects });
    return { objects, pages };
  },
);

// ---- Pages ----

const MAX_PAGES = 50;

/** Writes operations made by the server itself and shares them with the room. */
async function applyServerOperations(boardId: string, operations: Operation[]) {
  for (let index = 0; index < operations.length; index += 100)
    await Promise.all(
      operations.slice(index, index + 100).map(async (op) => {
        await store.applyOperation(boardId, op);
        broadcast(boardId, { t: 'op', op, by: 'server' });
      }),
    );
}

async function editablePages(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ board: BoardMeta } | undefined> {
  const user = await currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = await getAccess(boardId, user.id);
  if (!access) {
    apiError(reply, 404, 'Board not found.');
    return;
  }
  if (!canEdit(access.role, access.board)) {
    apiError(reply, 403, editBlockedReason(access.role, access.board));
    return;
  }
  return { board: access.board };
}

async function savePages(board: BoardMeta, pages: Page[]) {
  const next = { ...board, pages, updatedAt: new Date().toISOString() };
  await store.updateMeta(board.id, { pages, updatedAt: next.updatedAt });
  broadcastBoard(next);
  return next.pages;
}

app.post('/api/boards/:boardId/pages', async (request, reply) => {
  const body = z
    .object({
      id: pageIdSchema,
      name: pageNameSchema,
      duplicateOf: pageIdSchema.optional(),
    })
    .safeParse(request.body);
  if (!body.success)
    return apiError(reply, 400, 'Page names are 1–60 characters.');
  const access = await editablePages(request, reply);
  if (!access) return;
  const { board } = access;
  if (board.pages.some((page) => page.id === body.data.id))
    return { pages: board.pages };
  if (board.pages.length >= MAX_PAGES)
    return apiError(reply, 400, `A board can have up to ${MAX_PAGES} pages.`);
  const page = { id: body.data.id, name: body.data.name };
  const source = body.data.duplicateOf;
  const at = source
    ? board.pages.findIndex((item) => item.id === source) + 1
    : board.pages.length;
  const pages = [...board.pages];
  pages.splice(at > 0 ? at : pages.length, 0, page);
  // The page must exist before its objects arrive, or peers would briefly
  // show them on the first page.
  const saved = await savePages(board, pages);
  if (source) {
    const copies = (await store.getObjects(board.id))
      .filter((object) => pageOf(object, board.pages) === source)
      .map((object): Operation => {
        const id = randomUUID();
        return {
          id: randomUUID(),
          type: 'create',
          objectId: id,
          object: { ...object, id, page: page.id },
        };
      });
    await applyServerOperations(board.id, copies);
  }
  return reply.code(201).send({ pages: saved });
});

app.patch('/api/boards/:boardId/pages/:pageId', async (request, reply) => {
  const body = z.object({ name: pageNameSchema }).safeParse(request.body);
  if (!body.success)
    return apiError(reply, 400, 'Page names are 1–60 characters.');
  const access = await editablePages(request, reply);
  if (!access) return;
  const { pageId } = request.params as { pageId: string };
  const { board } = access;
  if (!board.pages.some((page) => page.id === pageId))
    return apiError(reply, 404, 'That page no longer exists.');
  return {
    pages: await savePages(
      board,
      board.pages.map((page) =>
        page.id === pageId ? { ...page, name: body.data.name } : page,
      ),
    ),
  };
});

app.put('/api/boards/:boardId/pages/order', async (request, reply) => {
  const body = z
    .object({ ids: z.array(pageIdSchema).max(MAX_PAGES) })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, 'Invalid page order.');
  const access = await editablePages(request, reply);
  if (!access) return;
  const { board } = access;
  const byId = new Map(board.pages.map((page) => [page.id, page]));
  const ordered = body.data.ids.flatMap((id) => byId.get(id) ?? []);
  // Pages someone else added meanwhile keep their place at the end.
  for (const page of board.pages)
    if (!ordered.includes(page)) ordered.push(page);
  return { pages: await savePages(board, ordered) };
});

app.delete('/api/boards/:boardId/pages/:pageId', async (request, reply) => {
  const access = await editablePages(request, reply);
  if (!access) return;
  const { pageId } = request.params as { pageId: string };
  const { board } = access;
  if (!board.pages.some((page) => page.id === pageId))
    return { pages: board.pages };
  if (board.pages.length === 1)
    return apiError(reply, 400, 'A board needs at least one page.');
  const removed = (await store.getObjects(board.id))
    .filter((object) => pageOf(object, board.pages) === pageId)
    .map((object): Operation => ({
      id: randomUUID(),
      type: 'delete',
      objectId: object.id,
    }));
  // Objects go first so they never fall back onto another page.
  await applyServerOperations(board.id, removed);
  return {
    pages: await savePages(
      board,
      board.pages.filter((page) => page.id !== pageId),
    ),
  };
});

/** A lightweight copy of a board's first page for dashboard thumbnails. */
app.get('/api/boards/:boardId/preview', async (request, reply) => {
  const { boardId } = request.params as { boardId: string };
  // Dashboards ask for one preview per board, so read everything at once.
  const [access, stored] = await Promise.all([
    readAccess(request, reply, 'Board not found.'),
    store.getObjects(boardId),
  ]);
  if (!access) return;
  const { pages } = access.board;
  const objects = stored
    .filter((object) => pageOf(object, pages) === pages[0]!.id)
    .slice(0, 400)
    .map((object) => {
      const preview: BoardObject = { ...object };
      if (preview.src) delete preview.src;
      const points = preview.points;
      if (points && points.length > 240) {
        // Keep roughly 120 samples, always including the last one.
        const step = Math.ceil(points.length / 240) * 2;
        const thinned: number[] = [];
        for (let index = 0; index < points.length - 1; index += step)
          thinned.push(points[index]!, points[index + 1]!);
        thinned.push(points.at(-2)!, points.at(-1)!);
        preview.points = thinned;
      }
      return preview;
    });
  return { pages: pages.length, objects };
});

// ---- Billing ----

const orderIdSchema = z.string().regex(ORDER_ID);
// Opening checkout again within this long hands back the same unpaid order,
// so a double click or a second tab can't lead to two charges.
const ORDER_REUSE_MINUTES = 20;

/**
 * Applies a captured payment, from whichever path reported it first, and
 * unlocks the owner's boards for everyone in them when it extended the pass.
 */
async function applyCapture(
  capture: Capture,
  log: FastifyRequest['log'],
): Promise<CaptureResult> {
  const result = await applyPayment(capture, {
    store,
    passDays: config.passDays,
    appUrl: config.appUrl,
    log,
    welcome: mailConfigured() ? sendPremiumWelcome : undefined,
    background: runInBackground,
  });
  if (result.outcome === 'applied') {
    for (const boardId of await store.boardIdsFor(result.userId)) {
      const board = await store.getMeta(boardId);
      if (board?.ownerId === result.userId) broadcastBoard(board);
    }
  }
  return result;
}

/**
 * Takes back the Premium time a fully refunded payment bought, and updates
 * the owner's open boards when that ends Premium.
 */
async function applyRefund(
  refund: { paymentId: string; amount: number; currency: string },
  log: FastifyRequest['log'],
) {
  const result = await store.refundPayment(refund, config.passDays);
  const context = { ...refund, outcome: result.outcome };
  if (result.outcome === 'refunded') {
    log.info(context, 'Refund took Premium time back');
    for (const boardId of await store.boardIdsFor(result.userId)) {
      const board = await store.getMeta(boardId);
      if (board?.ownerId === result.userId) broadcastBoard(board);
    }
  } else if (result.outcome === 'partial')
    log.warn(context, 'Partial refund: Premium left as it was');
  else if (result.outcome === 'unmigrated')
    log.error(context, 'Refund not applied: the database needs migrating');
  return result;
}

/**
 * Rupees for visitors in India, by the country Vercel's edge sets; dollars
 * elsewhere. While PayPal is in sandbox mode its testers get dollars, and so
 * PayPal, wherever they are, so they can test without a VPN.
 */
const currencyOf = (request: FastifyRequest, email?: string) =>
  config.usdBankTransferPreviewOnly
    ? 'USD'
    : config.paypal?.mode === 'sandbox' && paypalAllowedFor(email)
    ? 'USD'
    : currencyForCountry(
        request.headers['x-vercel-ip-country'] as string | undefined,
      );

app.get('/api/billing/plan', async (request) => {
  const user = await userFromRequest(request.raw).catch(() => undefined);
  const email = user && !user.guest ? user.email : undefined;
  const currency = currencyOf(request, email);
  const provider = checkoutFor(currency, email);
  const bankTransferAvailable =
    currency === 'USD' &&
    Boolean(
      config.usdBankTransfer &&
        (adminStore || config.usdBankTransferPreviewOnly),
    );
  return {
    available: Boolean(provider) || bankTransferAvailable,
    currency,
    provider: provider ?? null,
    bankTransferAvailable,
    plans: plansFor(currency),
    // The client ID is public: PayPal's buttons load with it.
    ...(provider === 'paypal' && config.paypal
      ? {
          paypal: {
            clientId: config.paypal.clientId,
            mode: config.paypal.mode,
          },
        }
      : {}),
    limits: { trialBoards: TRIAL_BOARDS, trialGuests: TRIAL_GUESTS },
  };
});

app.post('/api/billing/bank-transfer', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  if (user.guest)
    return apiError(reply, 403, 'Create an account before upgrading.');
  if (user.verifyAvailable && user.emailVerified === false)
    return apiError(
      reply,
      403,
      'Verify your email before upgrading. We’ve sent you a 6-digit code. Check your inbox and spam folder.',
      'email_unverified',
    );
  if (!(await allow(reply, `bank-transfer:${user.id}`, 10, 3600))) return;
  if (!config.usdBankTransfer || (!adminStore && !config.usdBankTransferPreviewOnly))
    return apiError(reply, 503, 'Bank transfers aren’t available yet.');
  if (currencyOf(request, user.email) !== 'USD')
    return apiError(reply, 400, 'Bank transfers are available for USD plans.');
  const body = z
    .object({ plan: z.enum(PLAN_IDS) })
    .safeParse(request.body ?? {});
  if (!body.success) return apiError(reply, 400, 'Choose a plan.');
  const plan = planById(body.data.plan, 'USD')!;
  const bankReference = `CR-${randomBytes(5).toString('hex').toUpperCase()}`;
  if (config.usdBankTransferPreviewOnly) {
    const { months, days } = termOfPlan(plan);
    return {
      request: {
        id: randomUUID(),
        userId: user.id,
        plan: plan.id,
        amount: plan.amount,
        currency: 'USD' as const,
        months,
        days,
        reference: bankReference,
        status: 'instructions' as const,
      },
      details: config.usdBankTransfer,
      previewOnly: true,
    };
  }
  const bankTransferStore = adminStore;
  if (!bankTransferStore)
    return apiError(reply, 503, 'Bank transfers aren’t available yet.');
  const bankRequest = await bankTransferStore.createBankTransferRequest({
    id: randomUUID(),
    userId: user.id,
    plan,
    reference: bankReference,
  });
  if (!bankRequest)
    return apiError(reply, 404, 'We couldn’t find your account.');
  return { request: bankRequest, details: config.usdBankTransfer, previewOnly: false };
});

app.post('/api/billing/bank-transfer/:id/submit', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  if (user.guest)
    return apiError(reply, 403, 'Create an account before upgrading.');
  if (config.usdBankTransferPreviewOnly)
    return apiError(reply, 503, 'Bank transfer submissions are disabled in Preview.');
  if (!(await allow(reply, `bank-transfer-submit:${user.id}`, 10, 3600)))
    return;
  const { id } = request.params as { id: string };
  const body = z
    .object({
      senderReference: z.string().trim().max(120).optional(),
    })
    .safeParse(request.body ?? {});
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  const bankRequest = await adminStore?.submitBankTransferRequest(
    id,
    user.id,
    body.data.senderReference || undefined,
  );
  if (!bankRequest)
    return apiError(reply, 404, 'Bank transfer request not found.');
  return { request: bankRequest };
});

// While the app is open in a visible tab, the page beats every ~20 seconds;
// only that time counts towards the 30-minute trial. The server measures the
// time between beats itself, so a page can't claim more than it was here.
app.post('/api/billing/heartbeat', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  if (user.guest) return { plan: null };
  if (!(await allow(reply, `beat:${user.id}`, 12, 60))) return;
  if (adminStore) await adminStore.recordAccountActivity(user.id);
  const before = tierOf(user.plan);
  const plan = await store.accrueTrial(user.id);
  // The trial ran out on this beat: apply the free plan to open boards now.
  if (plan && tierOf(plan) !== before) refreshOwnerPlan(user.id, plan);
  return { plan: plan ?? null };
});

app.post('/api/billing/create-order', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  if (user.guest)
    return apiError(reply, 403, 'Create an account before upgrading.');
  // Receipts and renewals go to the account's email, so it must be real.
  if (user.verifyAvailable && user.emailVerified === false)
    return apiError(
      reply,
      403,
      'Verify your email before upgrading. We’ve sent you a 6-digit code. Check your inbox and spam folder.',
      'email_unverified',
    );
  if (!(await allow(reply, `order:${user.id}`, 20, 3600))) return;
  // A page loaded before the plans sends no plan; it gets the 3-month one,
  // which costs what that page showed.
  const body = z
    .object({ plan: z.enum(PLAN_IDS).default('quarterly') })
    .safeParse(request.body ?? {});
  if (!body.success) return apiError(reply, 400, 'Choose a plan.');
  const currency = currencyOf(request, user.email);
  const price = planById(body.data.plan, currency)!;
  const provider = checkoutFor(currency, user.email);
  if (!provider) return apiError(reply, 503, 'Payments aren’t available yet.');
  if (provider === 'paypal')
    return paypalCheckout(request, reply, user.id, price);
  const checkout = (order: {
    orderId: string;
    amount: number;
    currency: string;
  }) => ({
    order_id: order.orderId,
    amount: order.amount,
    currency: order.currency,
    key_id: config.razorpay!.keyId,
    name: price.name,
    provider: 'razorpay' as const,
  });
  const open = await store.openOrder(
    user.id,
    price,
    ORDER_REUSE_MINUTES,
    'razorpay',
  );
  if (open) {
    // Reuse it only while Razorpay says it is unpaid. If it was paid but we
    // never heard (the tab closed before checkout reported back), apply that
    // payment now rather than charging again.
    const state = await orderCapture(open.orderId).catch((error: unknown) => {
      request.log.warn(error, 'Could not check an open Razorpay order');
      return undefined;
    });
    if (state && !state.paid) return checkout(open);
    if (state?.capture) {
      await applyCapture(state.capture, request.log);
      const account = await store.getAccount(user.id);
      return { already_paid: true, paidUntil: account?.paidUntil };
    }
  }
  try {
    const order = await createOrder(
      `cr_${Date.now().toString(36)}_${user.id.slice(0, 12)}`,
      user.id,
      price,
    );
    await store.createPayment({
      ...order,
      userId: user.id,
      provider: 'razorpay',
      plan: price.id,
      ...termOfPlan(price),
      status: 'created',
      createdAt: new Date().toISOString(),
    });
    return checkout(order);
  } catch (error) {
    request.log.error(error, 'Could not create a Razorpay order');
    if (error instanceof RazorpayError && error.status === 401)
      return apiError(
        reply,
        401,
        'Payments are misconfigured: Razorpay rejected our keys.',
        'payment_provider_auth',
      );
    if (error instanceof RazorpayError && error.status === 503)
      return apiError(reply, 503, 'Payments aren’t available yet.');
    return apiError(
      reply,
      500,
      'We couldn’t start the payment. Please try again in a moment.',
    );
  }
});

/** What the browser needs to open PayPal's buttons on an order. */
const paypalOrderReply = (
  order: { orderId: string; amount: number; currency: string },
  plan: PremiumPlan,
) => ({
  provider: 'paypal' as const,
  order_id: order.orderId,
  amount: order.amount,
  currency: order.currency,
  name: plan.name,
});

/** The account's Premium end after a payment was found already made. */
async function alreadyPaid(userId: string) {
  const account = await store.getAccount(userId);
  return { already_paid: true, paidUntil: account?.paidUntil };
}

/**
 * Creates (or reuses) a PayPal order for a plan. An open order is reused while
 * PayPal still waits on the buyer; one they approved but we never captured is
 * captured now, and one already paid is applied, so a second click never
 * charges twice.
 */
async function paypalCheckout(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  plan: PremiumPlan,
) {
  try {
    const open = await store.openOrder(
      userId,
      plan,
      ORDER_REUSE_MINUTES,
      'paypal',
    );
    if (open) {
      const state = await getPayPalOrder(open.orderId).catch(
        (error: unknown) => {
          request.log.warn(error, 'Could not check an open PayPal order');
          return undefined;
        },
      );
      if (
        state?.status === 'CREATED' ||
        state?.status === 'PAYER_ACTION_REQUIRED'
      )
        return paypalOrderReply(open, plan);
      if (state?.status === 'APPROVED' || state?.status === 'COMPLETED') {
        const done =
          state.status === 'APPROVED'
            ? await capturePayPalOrder(open.orderId)
            : state;
        const found = captureOfOrder(done, 'reconcile');
        if (found?.status === 'COMPLETED') {
          await applyCapture(found.capture, request.log);
          return alreadyPaid(userId);
        }
      }
    }
    const order = await createPayPalOrder(plan, userId);
    await store.createPayment({
      ...order,
      userId,
      provider: 'paypal',
      plan: plan.id,
      ...termOfPlan(plan),
      status: 'created',
      createdAt: new Date().toISOString(),
    });
    return paypalOrderReply(order, plan);
  } catch (error) {
    request.log.error(error, 'Could not create a PayPal order');
    if (error instanceof PayPalError && error.status === 401)
      return apiError(
        reply,
        401,
        'Payments are misconfigured: PayPal rejected our keys.',
        'payment_provider_auth',
      );
    return apiError(
      reply,
      500,
      'We couldn’t start the payment. Please try again in a moment.',
    );
  }
}

/** Replies to checkout once a payment was applied, or explains why not. */
async function paymentReply(
  reply: FastifyReply,
  userId: string,
  result: CaptureResult,
) {
  if (result.outcome === 'extra')
    return apiError(
      reply,
      409,
      'That order was already paid, so this second payment wasn’t used.',
      'already_paid',
    );
  if (result.outcome !== 'applied' && result.outcome !== 'repeat')
    return apiError(reply, 400, 'We don’t recognise that payment.');
  const paidUntil =
    result.outcome === 'applied'
      ? result.paidUntil
      : (await store.getAccount(userId))?.paidUntil;
  return { ok: true, paidUntil };
}

// PayPal's buttons call this once the buyer approves: the server captures
// the order (so the money moves only through our keys), checks the amount
// against the order, and applies it like any other payment.
app.post('/api/billing/paypal/capture', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const body = z
    .object({ order_id: z.string().regex(PAYPAL_ID) })
    .safeParse(request.body);
  if (!body.success)
    return apiError(reply, 400, 'The payment details are incomplete.');
  if (!(await allow(reply, `verify:${user.id}`, 30, 3600))) return;
  const orderId = body.data.order_id;
  const payment = await store.getPayment(orderId);
  // Orders belong to whoever created them; someone else's is "not found".
  if (
    !payment ||
    payment.userId !== user.id ||
    providerOf(payment) !== 'paypal'
  )
    return apiError(reply, 400, 'We don’t recognise that payment.');
  if (user.guest || !paypalAllowedFor(user.email))
    return apiError(reply, 403, 'PayPal isn’t available for this account.');
  let order;
  try {
    order = await capturePayPalOrder(orderId);
  } catch (error) {
    request.log.warn(error, 'PayPal capture failed');
    // The buyer's card or balance was declined: PayPal's window can offer
    // another way to pay on the same order.
    if (error instanceof PayPalError && error.issue === 'INSTRUMENT_DECLINED')
      return apiError(
        reply,
        402,
        'PayPal declined that payment method. Please choose another.',
        'instrument_declined',
      );
    return apiError(
      reply,
      502,
      'We couldn’t complete the PayPal payment. You haven’t been charged; please try again.',
    );
  }
  const found = captureOfOrder(order, 'checkout');
  // PayPal sometimes holds a payment for review; its webhook applies it once
  // it clears.
  if (found?.status === 'PENDING') return { ok: true, pending: true };
  if (!found || found.status !== 'COMPLETED')
    return apiError(
      reply,
      402,
      'PayPal didn’t complete the payment. You haven’t been charged.',
    );
  const result = await applyCapture(found.capture, request.log);
  return paymentReply(reply, user.id, result);
});

app.post('/api/billing/verify-payment', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const body = z
    .object({
      razorpay_order_id: orderIdSchema,
      razorpay_payment_id: z.string().regex(PAYMENT_ID),
      razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .safeParse(request.body);
  if (!body.success)
    return apiError(reply, 400, 'The payment details are incomplete.');
  if (!(await allow(reply, `verify:${user.id}`, 30, 3600))) return;
  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  } = body.data;
  const payment = await store.getPayment(orderId);
  // Orders belong to whoever created them; someone else's is "not found".
  if (!payment || payment.userId !== user.id)
    return apiError(reply, 400, 'We don’t recognise that payment.');
  if (!validPaymentSignature(orderId, paymentId, signature))
    return apiError(reply, 400, 'The payment could not be verified.');
  // The signature ties this payment to our order, whose amount we set. The
  // webhook may have applied it already; that is a repeat, not an error.
  const result = await applyCapture(
    { orderId, paymentId, source: 'checkout' },
    request.log,
  );
  return paymentReply(reply, user.id, result);
});

// Razorpay calls this when a payment is captured, so a pass is granted even
// if the browser never reports back. Set up in the Razorpay dashboard with
// the events payment.captured and order.paid, and the same secret in
// RAZORPAY_WEBHOOK_SECRET. The signature covers the raw bytes, so this route
// keeps the body unparsed.
app.register(async (webhook) => {
  webhook.removeContentTypeParser('application/json');
  webhook.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: 1_000_000 },
    (_request, body, done) => done(null, body),
  );
  webhook.post('/api/billing/webhook', async (request, reply) => {
    if (!config.razorpayWebhookSecret)
      return apiError(reply, 503, 'The payment webhook is not set up.');
    const signature = request.headers['x-razorpay-signature'];
    if (
      !Buffer.isBuffer(request.body) ||
      typeof signature !== 'string' ||
      !validWebhookSignature(request.body, signature)
    )
      return apiError(reply, 400, 'Invalid signature.');
    let event: unknown;
    try {
      event = JSON.parse(request.body.toString('utf8'));
    } catch {
      return apiError(reply, 400, 'Invalid body.');
    }
    const capture = webhookCapture(event);
    const refund = webhookRefund(event);
    // Other events, and orders that aren't ours, are acknowledged and
    // ignored. A database error answers 500, so Razorpay retries later.
    if (capture) await applyCapture(capture, request.log);
    if (refund) await applyRefund(refund, request.log);
    return { ok: true };
  });

  // PayPal calls this for captures, refunds and reversals. Registered for the
  // current mode (scripts/paypal-webhook.ts), with its ID in
  // PAYPAL_WEBHOOK_ID; PayPal itself confirms each call is genuine.
  webhook.post('/api/billing/paypal/webhook', async (request, reply) => {
    if (!config.paypal?.webhookId)
      return apiError(reply, 503, 'The PayPal webhook is not set up.');
    if (!Buffer.isBuffer(request.body))
      return apiError(reply, 400, 'Invalid body.');
    let event: unknown;
    try {
      event = JSON.parse(request.body.toString('utf8'));
    } catch {
      return apiError(reply, 400, 'Invalid body.');
    }
    let genuine: boolean;
    try {
      genuine = await verifyPayPalWebhook(request.headers, event);
    } catch (error) {
      // PayPal couldn't be asked; a 500 makes it retry later.
      request.log.error(error, 'Could not verify a PayPal webhook');
      return apiError(reply, 500, 'Could not verify the webhook.');
    }
    if (!genuine) return apiError(reply, 400, 'Invalid signature.');
    const read = readPayPalEvent(event);
    if (read.kind === 'capture') await applyCapture(read.capture, request.log);
    else if (read.kind === 'refund') await applyRefund(read, request.log);
    return { ok: true };
  });
});

// ---- Scheduled jobs ----

/** Whether a request carries Vercel's cron secret as its bearer token. */
function fromCron(request: FastifyRequest) {
  const secret = config.cronSecret;
  const header = request.headers.authorization;
  if (!secret || typeof header !== 'string') return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Daily, from the cron in vercel.json: emails everyone whose Premium ends in
// the next few days, once per end date.
app.get('/api/cron/premium-reminders', async (request, reply) => {
  if (!config.cronSecret)
    return apiError(reply, 503, 'Scheduled jobs are not set up.');
  if (!fromCron(request)) return apiError(reply, 401, 'Not allowed.');
  if (!mailConfigured())
    return apiError(
      reply,
      503,
      'Email is not set up, so no reminders went out.',
    );
  try {
    const result = await sendRenewalReminders({
      store,
      appUrl: config.appUrl,
      log: request.log,
      remind: sendPremiumReminder,
    });
    request.log.info(result, 'Premium reminders sent');
    return result;
  } catch (error) {
    // Before the database is migrated the reminder column doesn't exist.
    request.log.error(error, 'Premium reminders failed');
    return apiError(reply, 500, 'Premium reminders failed.');
  }
});

// ---- Library ----

// Packs are static files served by the web app; the server only remembers
// which ones each account installed, so they follow it to other devices.
const libraryPackId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const MAX_LIBRARY_PACKS = 50;

/** The signed-in account for library routes; guests keep packs in the browser. */
async function libraryAccount(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentUser(request, reply);
  if (!user) return;
  if (user.guest) {
    apiError(reply, 403, 'Create an account to sync your library.');
    return;
  }
  return user;
}

app.get('/api/library', async (request, reply) => {
  const user = await libraryAccount(request, reply);
  if (!user) return;
  return { packs: await store.listLibrary(user.id) };
});

app.put('/api/library/:pack', async (request, reply) => {
  const user = await libraryAccount(request, reply);
  if (!user) return;
  const pack = libraryPackId.safeParse(
    (request.params as { pack: string }).pack,
  );
  if (!pack.success) return apiError(reply, 400, 'Unknown library pack.');
  if (!(await allow(reply, `library:${user.id}`, 120, 3600))) return;
  const packs = await store.listLibrary(user.id);
  if (!packs.includes(pack.data) && packs.length >= MAX_LIBRARY_PACKS)
    return apiError(reply, 400, 'Your library is full. Remove a pack first.');
  await store.setLibraryPack(user.id, pack.data, true);
  return { packs: await store.listLibrary(user.id) };
});

app.delete('/api/library/:pack', async (request, reply) => {
  const user = await libraryAccount(request, reply);
  if (!user) return;
  const pack = libraryPackId.safeParse(
    (request.params as { pack: string }).pack,
  );
  if (!pack.success) return apiError(reply, 400, 'Unknown library pack.');
  if (!(await allow(reply, `library:${user.id}`, 120, 3600))) return;
  await store.setLibraryPack(user.id, pack.data, false);
  return { packs: await store.listLibrary(user.id) };
});

// ---- Feedback ----

const FEEDBACK_CATEGORIES = [
  'idea',
  'bug',
  'praise',
  'question',
  'other',
] as const;

app.post('/api/feedback', async (request, reply) => {
  const user = await userFromRequest(request.raw);
  const body = z
    .object({
      message: z
        .string()
        .trim()
        .min(3, 'Write a few words of feedback.')
        .max(4000, 'Keep feedback under 4,000 characters.'),
      category: z.enum(FEEDBACK_CATEGORIES).default('other'),
      rating: z.number().int().min(1).max(5).optional(),
      email: emailSchema.optional(),
      name: z.string().trim().max(80).optional(),
      page: z.string().trim().max(200).optional(),
    })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  // Account holders reply from their own address; anyone else gives one.
  const email = user?.email ?? body.data.email;
  if (!email) return apiError(reply, 400, 'Enter your email so we can reply.');
  if (
    !(await allow(reply, `feedback-ip:${clientIp(request)}`, 10, 3600)) ||
    !(await allow(reply, `feedback:${email}`, 5, 3600))
  )
    return;
  const feedback = {
    id: randomUUID(),
    ...(user && !user.guest ? { userId: user.id } : {}),
    email,
    ...((user?.name ?? body.data.name)
      ? { name: (user?.name ?? body.data.name)! }
      : {}),
    category: body.data.category,
    ...(body.data.rating ? { rating: body.data.rating } : {}),
    message: body.data.message,
    ...(body.data.page ? { page: body.data.page } : {}),
    createdAt: new Date().toISOString(),
  };
  await store.addFeedback(feedback);
  if (teamMailConfigured())
    try {
      await sendFeedback({
        ...feedback,
        account: Boolean(user && !user.guest),
      });
      await store.markFeedbackMailed(feedback.id);
    } catch (error) {
      // Saved either way; the team can read it from the database.
      request.log.error(error, 'Feedback email failed');
    }
  return reply.code(201).send({ ok: true });
});

// TURN credentials let anyone relay traffic through our server, so only
// people with a session get them (boards also send them in their welcome).
// ---- Voice (Cloudflare Realtime SFU) ----

const sdpSchema = z.string().min(10).max(100_000);
const sfuSessionSchema = z.string().regex(/^[0-9a-f]{16,128}$/);
const trackNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const midSchema = z.string().regex(/^[0-9]{1,6}$/);
/** The caller's own SFU session, proven by the token issued with it. */
const ownSessionSchema = z.object({
  sessionId: sfuSessionSchema,
  token: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * Who may use the board's call: members, while the board is open to them.
 * Replies itself and returns undefined when not.
 */
const callAccess = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!sfuConfigured()) {
    apiError(reply, 503, 'Voice calls are not set up on this server.');
    return;
  }
  const access = await readAccess(request, reply, 'Board not found.');
  if (!access) return;
  if (access.user.id !== access.board.ownerId && !openToOthers(access.board)) {
    apiError(
      reply,
      403,
      'This board is closed to others until its owner upgrades.',
    );
    return;
  }
  if (!(await allow(reply, `call:${access.user.id}`, 300, 600))) return;
  return access;
};

const ownSession = (
  reply: FastifyReply,
  boardId: string,
  userId: string,
  body: { sessionId: string; token: string },
) => {
  if (validSessionToken(boardId, userId, body.sessionId, body.token))
    return true;
  apiError(reply, 403, 'That call connection is not yours.');
  return false;
};

const sfuFailed = (
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) => {
  request.log.error(error, 'Cloudflare Realtime request failed');
  if (error instanceof SfuError && error.status === 401)
    return apiError(reply, 502, 'Voice is misconfigured on the server.');
  return apiError(
    reply,
    502,
    'The call could not connect right now. Please try again.',
  );
};

app.post('/api/boards/:boardId/call/publish', async (request, reply) => {
  const body = z
    .object({ sdp: sdpSchema, mid: midSchema })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, 'Invalid call offer.');
  const access = await callAccess(request, reply);
  if (!access) return;
  try {
    const published = await publish(body.data.sdp, body.data.mid);
    return {
      ...published,
      token: sessionToken(access.board.id, access.user.id, published.sessionId),
    };
  } catch (error) {
    return sfuFailed(request, reply, error);
  }
});

app.post('/api/boards/:boardId/call/pull', async (request, reply) => {
  const body = ownSessionSchema
    .extend({
      tracks: z
        .array(
          z.object({ sessionId: sfuSessionSchema, trackName: trackNameSchema }),
        )
        .min(1)
        .max(50),
    })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, 'Invalid call request.');
  const access = await callAccess(request, reply);
  if (!access) return;
  if (!ownSession(reply, access.board.id, access.user.id, body.data)) return;
  // Only microphones that people in this board's call published.
  const published = new Set(
    (await store.listPresence(access.board.id))
      .filter((peer) => peer.inCall && peer.audio)
      .map((peer) => `${peer.audio!.session}/${peer.audio!.track}`),
  );
  const tracks = body.data.tracks.filter((track) =>
    published.has(`${track.sessionId}/${track.trackName}`),
  );
  if (!tracks.length) return { tracks: [] };
  try {
    return await pull(body.data.sessionId, tracks);
  } catch (error) {
    return sfuFailed(request, reply, error);
  }
});

app.post('/api/boards/:boardId/call/renegotiate', async (request, reply) => {
  const body = ownSessionSchema
    .extend({ sdp: sdpSchema })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, 'Invalid call answer.');
  const access = await callAccess(request, reply);
  if (!access) return;
  if (!ownSession(reply, access.board.id, access.user.id, body.data)) return;
  try {
    await renegotiate(body.data.sessionId, body.data.sdp);
    return { ok: true };
  } catch (error) {
    return sfuFailed(request, reply, error);
  }
});

app.post('/api/boards/:boardId/call/close', async (request, reply) => {
  const body = ownSessionSchema
    .extend({ sdp: sdpSchema, mids: z.array(midSchema).min(1).max(50) })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, 'Invalid call request.');
  const access = await callAccess(request, reply);
  if (!access) return;
  if (!ownSession(reply, access.board.id, access.user.id, body.data)) return;
  try {
    return await closeTracks(
      body.data.sessionId,
      body.data.sdp,
      body.data.mids,
    );
  } catch (error) {
    return sfuFailed(request, reply, error);
  }
});

app.get('/api/ice-servers', async (request, reply) => {
  if (!(await currentUser(request, reply))) return;
  return { iceServers: config.iceServers };
});

app.get('/api/health', async () => ({
  status: 'ok',
  service: 'collabboard-api',
  storage: storageKind,
}));
app.get('/health', async () => ({ status: 'ok', service: 'collabboard-api' }));

app.addHook('onReady', loadStore);

// On Vercel the runtime manages the port, so listen the way its Fastify
// integration expects; locally use the configured host and port.
app
  .listen(
    process.env.VERCEL
      ? { port: Number(process.env.PORT ?? 3000) }
      : { port: config.serverPort, host: config.serverHost },
  )
  .catch((error: unknown) => {
    app.log.error(error);
    process.exitCode = 1;
  });
