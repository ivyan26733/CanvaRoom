import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
  billingConfigured,
  createOrder,
  priceFor,
  RazorpayError,
  validPaymentSignature,
} from './billing.js';
import {
  mailConfigured,
  sendFeedback,
  sendPasswordReset,
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
import { pageIdSchema, pageNameSchema } from './schemas.js';
import { TEMPLATES, templateObjects } from './templates.js';
import {
  DEFAULT_PAGES,
  FREE_BOARDS,
  pageOf,
  tierOf,
  TRIAL_BOARDS,
  TRIAL_GUESTS,
} from './models.js';
import type {
  Account,
  BoardMeta,
  BoardObject,
  Operation,
  Page,
  Snapshot,
  User,
} from './models.js';

const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
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
    trialUsedSeconds: 0,
  };
  if (!(await store.createAccount(account)))
    return apiError(
      reply,
      409,
      'An account with this email already exists. Sign in instead.',
    );
  if (current?.guest) {
    const guestSession = currentSessionKey(request.raw);
    if (guestSession) await store.deleteSession(guestSession);
    await renameEverywhere(publicUser(account));
  }
  await startSession(request, reply, publicUser(account));
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

const RESET_TTL_SECONDS = 30 * 60;
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('base64url');

app.post('/api/auth/forgot', async (request, reply) => {
  const body = z.object({ email: emailSchema }).safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  // Local development without email prints the link to the server log.
  const printLink = !mailConfigured() && !process.env.VERCEL;
  if (!mailConfigured() && !printLink)
    return apiError(
      reply,
      503,
      'Password reset email isn’t available yet. Please contact support.',
    );
  if (
    !(await allow(reply, `forgot-ip:${clientIp(request)}`, 10, 3600)) ||
    !(await allow(reply, `forgot:${body.data.email}`, 3, 3600))
  )
    return;
  const account = await store.findAccountByEmail(body.data.email);
  // The reply is the same whether or not the account exists.
  if (account) {
    const token = randomBytes(32).toString('base64url');
    await store.createResetToken(
      hashToken(token),
      account.id,
      RESET_TTL_SECONDS,
    );
    const link = `${config.appUrl}/reset-password?token=${token}`;
    try {
      if (printLink) request.log.warn({ link }, 'Password reset link (dev)');
      else await sendPasswordReset(account.email, account.name, link);
    } catch (error) {
      request.log.error(error, 'Password reset email failed');
      return apiError(
        reply,
        502,
        'We couldn’t send the email right now. Please try again shortly.',
      );
    }
  }
  return {
    ok: true,
    message:
      'If an account uses that email, a reset link is on its way. It works for 30 minutes.',
  };
});

app.post('/api/auth/reset', async (request, reply) => {
  const body = z
    .object({ token: z.string().min(20).max(200), password: passwordSchema })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, firstIssue(body.error));
  if (!(await allow(reply, `reset-ip:${clientIp(request)}`, 20, 900))) return;
  const userId = await store.takeResetToken(hashToken(body.data.token));
  const account = userId ? await store.getAccount(userId) : undefined;
  if (!account)
    return apiError(
      reply,
      400,
      'This reset link has expired or was already used. Request a new one.',
    );
  await store.updateAccount(account.id, {
    passwordHash: await hashPassword(body.data.password),
  });
  // Whoever knew the old password is signed out everywhere.
  await store.deleteSessionsFor(account.id);
  await startSession(request, reply, publicUser(account));
  return { user: publicUser(account) };
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
      // Uploaded bytes are only ever shown as images, never run as a page.
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
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

const orderIdSchema = z.string().regex(/^order_[A-Za-z0-9]{6,40}$/);

/** Vercel's edge sets the visitor's country; locally it is missing. */
const countryOf = (request: FastifyRequest) =>
  request.headers['x-vercel-ip-country'] as string | undefined;

app.get('/api/billing/plan', async (request) => ({
  available: billingConfigured(),
  pass: priceFor(countryOf(request)),
  limits: { trialBoards: TRIAL_BOARDS, trialGuests: TRIAL_GUESTS },
}));

// While the app is open in a visible tab, the page beats every ~20 seconds;
// only that time counts towards the 30-minute trial. The server measures the
// time between beats itself, so a page can't claim more than it was here.
app.post('/api/billing/heartbeat', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  if (user.guest) return { plan: null };
  if (!(await allow(reply, `beat:${user.id}`, 12, 60))) return;
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
  if (!(await allow(reply, `order:${user.id}`, 20, 3600))) return;
  const price = priceFor(countryOf(request));
  if (price.amount < 100)
    return apiError(reply, 500, 'The Premium price is set too low.');
  try {
    const order = await createOrder(
      `cr_${Date.now().toString(36)}_${user.id.slice(0, 12)}`,
      user.id,
      price,
    );
    await store.createPayment({
      ...order,
      userId: user.id,
      status: 'created',
      createdAt: new Date().toISOString(),
    });
    return {
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      key_id: config.razorpay!.keyId,
      name: price.name,
    };
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

app.post('/api/billing/verify-payment', async (request, reply) => {
  const user = await currentUser(request, reply);
  if (!user) return;
  const body = z
    .object({
      razorpay_order_id: orderIdSchema,
      razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/),
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
  if (payment.status === 'paid' && payment.paymentId !== paymentId)
    return apiError(reply, 400, 'That order was already paid.');
  const paidUntil =
    (await store.completePayment(orderId, paymentId, config.passDays)) ??
    (await store.getAccount(user.id))?.paidUntil;
  // Boards the user owns become editable for everyone in them right away.
  for (const boardId of await store.boardIdsFor(user.id)) {
    const board = await store.getMeta(boardId);
    if (board?.ownerId === user.id) broadcastBoard(board);
  }
  return { ok: true, paidUntil };
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
