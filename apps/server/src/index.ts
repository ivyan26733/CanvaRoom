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
import { canEdit, editBlockedReason, publicBoard } from './boards.js';
import { mailConfigured, sendPasswordReset } from './mail.js';
import { attachRealtime, broadcast, broadcastBoard } from './realtime.js';
import { loadStore, storageKind, store } from './store.js';
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
import { DEFAULT_PAGES, pageOf } from './models.js';
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

const apiError = (reply: FastifyReply, status: number, message: string) =>
  reply.code(status).send({ error: message });
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

// TURN credentials let anyone relay traffic through our server, so only
// people with a session get them (boards also send them in their welcome).
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
