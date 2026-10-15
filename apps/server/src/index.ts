import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { issueSession, requestUser, verifySession } from './auth.js';
import { publicBoard } from './boards.js';
import { attachRealtime, broadcast, broadcastBoard } from './realtime.js';
import { loadStore, store } from './store.js';
import type { BoardMeta, BoardObject, Snapshot } from './models.js';

const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
attachRealtime(app.server);

const apiError = (reply: FastifyReply, status: number, message: string) =>
  reply.code(status).send({ error: message });
const currentUser = (request: FastifyRequest, reply: FastifyReply) => {
  const user = requestUser(request);
  if (!user) {
    apiError(reply, 401, 'Your session expired. Please sign in again.');
    return;
  }
  return user;
};
const getAccess = async (boardId: string, userId: string) => {
  const board = await store.getMeta(boardId);
  const membership = board?.members[userId];
  return board && membership ? { board, role: membership.role } : undefined;
};
const inviteId = () => randomBytes(24).toString('base64url');

app.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin;
  if (origin)
    reply
      .header('Access-Control-Allow-Origin', origin)
      .header('Vary', 'Origin');
  reply
    .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    .header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    .header('Cache-Control', 'no-store');
  if (request.method === 'OPTIONS') return reply.code(204).send();
});

app.post('/api/session', async (request, reply) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(48) })
    .safeParse(request.body);
  if (!body.success)
    return apiError(reply, 400, 'Enter a name between 1 and 48 characters.');
  const token = issueSession(body.data.name);
  return { token, user: verifySession(token)! };
});

app.get('/api/boards', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  return store.listBoards(user.id);
});

app.post('/api/boards', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const body = z
    .object({ title: z.string().trim().min(1).max(80) })
    .safeParse(request.body);
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
  };
  await store.createBoard(board, []);
  return reply.code(201).send(publicBoard(board, 'owner'));
});

app.get('/api/boards/:boardId', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = await getAccess(boardId, user.id);
  if (!access)
    return apiError(reply, 404, 'Board not found or you do not have access.');
  return publicBoard(access.board, access.role);
});

app.patch('/api/boards/:boardId', async (request, reply) => {
  const user = currentUser(request, reply);
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
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = await getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  if (access.role !== 'owner')
    return apiError(reply, 403, 'Only the board owner can delete this board.');
  await store.deleteBoard(boardId);
  broadcast(boardId, { t: 'deleted' });
  return reply.code(204).send();
});

app.post('/api/boards/:boardId/duplicate', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const source = await getAccess(boardId, user.id);
  if (!source) return apiError(reply, 404, 'Board not found.');
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
  };
  await store.createBoard(duplicate, await store.getObjects(boardId));
  return reply.code(201).send(publicBoard(duplicate, 'owner'));
});

app.post('/api/boards/:boardId/join', async (request, reply) => {
  const user = currentUser(request, reply);
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
  const user = currentUser(request, reply);
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
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = await getAccess(boardId, user.id);
  if (!access || access.role !== 'owner')
    return apiError(reply, 403, 'Only the owner can manage invites.');
  await store.updateMeta(boardId, { inviteRevoked: true });
  return reply.code(204).send();
});

app.patch('/api/boards/:boardId/members/:memberId', async (request, reply) => {
  const user = currentUser(request, reply);
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
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = await getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  return (await store.getSnapshots(boardId)).map(
    ({ id, title, createdAt }) => ({ id, title, createdAt }),
  );
});

app.post('/api/boards/:boardId/snapshots', async (request, reply) => {
  const user = currentUser(request, reply);
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
    const user = currentUser(request, reply);
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
    await store.replaceObjects(boardId, objects);
    broadcast(boardId, { t: 'reset', objects });
    return { objects };
  },
);

app.get('/api/ice-servers', async () => ({ iceServers: config.iceServers }));

app.get('/api/health', async () => ({
  status: 'ok',
  service: 'collabboard-api',
  storage: config.redisUrl ? 'redis' : 'memory',
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
