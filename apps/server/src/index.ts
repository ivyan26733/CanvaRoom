import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { issueSession, requestUser } from './auth.js';
import { addStream, peers, publish, updatePresence } from './events.js';
import { change, getBoard, loadState, readState } from './store.js';
import type { BoardRecord, BoardObject, Operation, Role } from './models.js';

const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/);
const objectSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum([
    'path',
    'line',
    'rect',
    'ellipse',
    'diamond',
    'arrow',
    'text',
    'sticky',
    'image',
  ]),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().optional(),
  height: z.number().finite().optional(),
  points: z.array(z.number().finite()).max(100_000).optional(),
  text: z.string().max(20_000).optional(),
  src: z
    .string()
    .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .max(800_000)
    .optional(),
  color: colorSchema,
  strokeWidth: z.number().min(1).max(80),
  rotation: z.number().finite().optional(),
  fontSize: z.number().min(8).max(120).optional(),
  opacity: z.number().min(0).max(1).optional(),
  fillColor: colorSchema.optional(),
});
const fieldsSchema = z
  .object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().optional(),
    height: z.number().finite().optional(),
    points: z.array(z.number().finite()).max(100_000).optional(),
    text: z.string().max(20_000).optional(),
    src: z
      .string()
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
      .max(800_000)
      .optional(),
    color: colorSchema.optional(),
    strokeWidth: z.number().min(1).max(80).optional(),
    rotation: z.number().finite().optional(),
    fontSize: z.number().min(8).max(120).optional(),
    opacity: z.number().min(0).max(1).optional(),
    fillColor: colorSchema.optional(),
  })
  .strict();
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
const getAccess = (boardId: string, userId: string) => {
  const board = getBoard(boardId);
  const membership = board?.members[userId];
  return board && membership ? { board, role: membership.role } : undefined;
};
const canEdit = (role: Role, board: BoardRecord) =>
  role !== 'viewer' && !board.locked;
const publicBoard = (board: BoardRecord, role: Role) => ({
  id: board.id,
  title: board.title,
  ownerId: board.ownerId,
  role,
  locked: board.locked,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
  revision: board.revision,
  objects: Object.values(board.objects),
  messages: board.messages,
  members: Object.entries(board.members).map(([userId, member]) => ({
    userId,
    ...member,
    online: false,
  })),
  inviteToken: role === 'owner' ? board.inviteToken : undefined,
  inviteRevoked: role === 'owner' ? board.inviteRevoked : undefined,
});
const inviteId = () => randomBytes(24).toString('base64url');

app.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin;
  if (origin)
    reply
      .header('Access-Control-Allow-Origin', origin)
      .header('Vary', 'Origin');
  reply
    .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    .header(
      'Access-Control-Allow-Methods',
      'GET, POST, PATCH, DELETE, OPTIONS',
    );
  if (request.method === 'OPTIONS') return reply.code(204).send();
});

app.post('/api/session', async (request, reply) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(48) })
    .safeParse(request.body);
  if (!body.success)
    return apiError(reply, 400, 'Enter a name between 1 and 48 characters.');
  const token = issueSession(body.data.name);
  const user = requestUser({
    headers: { authorization: `Bearer ${token}` },
  } as FastifyRequest)!;
  return { token, user };
});

app.get('/api/boards', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  return Object.values(readState().boards)
    .filter((board) => board.members[user.id])
    .map((board) => ({
      id: board.id,
      title: board.title,
      role: board.members[user.id]!.role,
      locked: board.locked,
      updatedAt: board.updatedAt,
      objectCount: Object.keys(board.objects).length,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  const board: BoardRecord = {
    id: randomUUID(),
    title: body.data.title,
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
    locked: false,
    members: { [user.id]: { role: 'owner', name: user.name } },
    inviteToken: inviteId(),
    inviteRevoked: false,
    objects: {},
    deletedObjectIds: [],
    operations: [],
    seenOperationIds: [],
    messages: [],
    snapshots: [],
    revision: 0,
  };
  await change((state) => {
    state.boards[board.id] = board;
  });
  return reply.code(201).send(publicBoard(board, 'owner'));
});

app.get('/api/boards/:boardId', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = getAccess(boardId, user.id);
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
  const access = getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  if (access.role !== 'owner')
    return apiError(
      reply,
      403,
      'Only the board owner can change these settings.',
    );
  await change((state) => {
    const board = state.boards[boardId]!;
    if (body.data.title !== undefined) board.title = body.data.title;
    if (body.data.locked !== undefined) board.locked = body.data.locked;
    board.updatedAt = new Date().toISOString();
  });
  publish(boardId, {
    type: 'board',
    board: publicBoard(access.board, access.role),
  });
  return publicBoard(access.board, access.role);
});

app.delete('/api/boards/:boardId', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  if (access.role !== 'owner')
    return apiError(reply, 403, 'Only the board owner can delete this board.');
  await change((state) => {
    delete state.boards[boardId];
  });
  publish(boardId, { type: 'deleted' });
  return reply.code(204).send();
});

app.post('/api/boards/:boardId/duplicate', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const source = getAccess(boardId, user.id);
  if (!source) return apiError(reply, 404, 'Board not found.');
  if (source.role === 'viewer')
    return apiError(reply, 403, 'Viewers cannot duplicate this board.');
  const now = new Date().toISOString();
  const duplicate: BoardRecord = {
    ...source.board,
    id: randomUUID(),
    title: `${source.board.title} copy`.slice(0, 80),
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
    locked: false,
    members: { [user.id]: { role: 'owner', name: user.name } },
    inviteToken: inviteId(),
    inviteRevoked: false,
    objects: JSON.parse(JSON.stringify(source.board.objects)) as Record<
      string,
      BoardObject
    >,
    deletedObjectIds: [],
    operations: [],
    seenOperationIds: [],
    messages: [],
    snapshots: [],
    revision: 0,
  };
  await change((state) => {
    state.boards[duplicate.id] = duplicate;
  });
  return reply.code(201).send(publicBoard(duplicate, 'owner'));
});

app.post('/api/boards/:boardId/join', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const body = z
    .object({ inviteToken: z.string().min(1) })
    .safeParse(request.body);
  const board = getBoard(boardId);
  if (
    !body.success ||
    !board ||
    board.inviteRevoked ||
    body.data.inviteToken !== board.inviteToken
  )
    return apiError(reply, 404, 'This invite is invalid or has been revoked.');
  await change((state) => {
    state.boards[boardId]!.members[user.id] = {
      role: 'editor',
      name: user.name,
    };
  });
  publish(boardId, {
    type: 'members',
    members: Object.entries(board.members).map(([userId, member]) => ({
      userId,
      ...member,
    })),
  });
  return publicBoard(board, 'editor');
});

app.post('/api/boards/:boardId/invites/regenerate', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  if (access.role !== 'owner')
    return apiError(reply, 403, 'Only the owner can manage invites.');
  await change((state) => {
    const board = state.boards[boardId]!;
    board.inviteToken = inviteId();
    board.inviteRevoked = false;
  });
  return { inviteToken: access.board.inviteToken };
});

app.delete('/api/boards/:boardId/invites', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = getAccess(boardId, user.id);
  if (!access || access.role !== 'owner')
    return apiError(reply, 403, 'Only the owner can manage invites.');
  await change((state) => {
    state.boards[boardId]!.inviteRevoked = true;
  });
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
  const access = getAccess(boardId, user.id);
  if (!access || access.role !== 'owner')
    return apiError(reply, 403, 'Only the owner can change member roles.');
  if (
    !body.success ||
    memberId === access.board.ownerId ||
    !access.board.members[memberId]
  )
    return apiError(reply, 400, 'Invalid member role update.');
  await change((state) => {
    state.boards[boardId]!.members[memberId]!.role = body.data.role;
  });
  publish(boardId, {
    type: 'members',
    members: Object.entries(access.board.members).map(([id, member]) => ({
      userId: id,
      ...member,
    })),
  });
  return { ok: true };
});

app.post('/api/boards/:boardId/operations', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  if (!canEdit(access.role, access.board))
    return apiError(
      reply,
      403,
      access.board.locked
        ? 'The teacher has paused editing.'
        : 'You have view-only access.',
    );
  const body = z
    .object({
      id: z.string().min(1).max(100),
      type: z.enum(['create', 'update', 'delete']),
      objectId: z.string().min(1).max(100),
      object: objectSchema.optional(),
      fields: fieldsSchema.optional(),
    })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, 'Invalid canvas update.');
  if (
    body.data.type === 'create' &&
    (!body.data.object || body.data.object.id !== body.data.objectId)
  )
    return apiError(reply, 400, 'New canvas item is invalid.');
  if (body.data.type === 'update' && !body.data.fields)
    return apiError(reply, 400, 'Canvas update has no fields.');
  if (
    body.data.fields &&
    Object.keys(body.data.fields).some(
      (field) =>
        ![
          'x',
          'y',
          'width',
          'height',
          'points',
          'text',
          'src',
          'color',
          'strokeWidth',
          'rotation',
          'fontSize',
        ].includes(field),
    )
  )
    return apiError(reply, 400, 'Canvas update contains an unsupported field.');
  let operation: Operation | undefined;
  const result = await change((state) => {
    const board = state.boards[boardId];
    if (!board || !board.members[user.id])
      return {
        duplicate: false,
        error: 'Board access changed. Refresh and try again.',
      };
    if (!canEdit(board.members[user.id]!.role, board))
      return {
        duplicate: false,
        error: board.locked
          ? 'The teacher has paused editing.'
          : 'You have view-only access.',
      };
    if (board.seenOperationIds.includes(body.data.id))
      return { duplicate: true };
    board.seenOperationIds.push(body.data.id);
    if (board.seenOperationIds.length > 4000)
      board.seenOperationIds.splice(0, board.seenOperationIds.length - 4000);
    const tombstoned = board.deletedObjectIds.includes(body.data.objectId);
    if (body.data.type === 'delete') {
      board.deletedObjectIds.push(body.data.objectId);
      delete board.objects[body.data.objectId];
    } else if (
      !tombstoned &&
      body.data.type === 'create' &&
      !board.objects[body.data.objectId]
    ) {
      board.objects[body.data.objectId] = body.data.object as BoardObject;
    } else if (
      !tombstoned &&
      body.data.type === 'update' &&
      board.objects[body.data.objectId]
    ) {
      const fields = body.data.fields as Partial<BoardObject>;
      board.objects[body.data.objectId] = {
        ...board.objects[body.data.objectId]!,
        ...fields,
      };
    }
    board.revision += 1;
    board.updatedAt = new Date().toISOString();
    const nextOperation: Operation = {
      id: body.data.id,
      type: body.data.type,
      objectId: body.data.objectId,
      boardId,
      actorId: user.id,
      createdAt: board.updatedAt,
      revision: board.revision,
      ...(body.data.object ? { object: body.data.object as BoardObject } : {}),
      ...(body.data.fields
        ? { fields: body.data.fields as Partial<BoardObject> }
        : {}),
    };
    operation = nextOperation;
    board.operations.push(nextOperation);
    if (board.operations.length > 2000) board.operations.shift();
    return { duplicate: false };
  });
  if (result.error) return apiError(reply, 403, result.error);
  if (!result.duplicate && operation)
    publish(boardId, { type: 'operation', operation });
  return {
    ok: true,
    duplicate: result.duplicate,
    revision: access.board.revision,
  };
});

app.post('/api/boards/:boardId/messages', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  const body = z
    .object({ text: z.string().trim().min(1).max(2000) })
    .safeParse(request.body);
  if (!body.success)
    return apiError(reply, 400, 'Message must be 1–2000 characters.');
  const message = {
    id: randomUUID(),
    userId: user.id,
    name: user.name,
    text: body.data.text,
    createdAt: new Date().toISOString(),
  };
  await change((state) => {
    const messages = state.boards[boardId]!.messages;
    messages.push(message);
    if (messages.length > 500) messages.shift();
  });
  publish(boardId, { type: 'message', message });
  return reply.code(201).send(message);
});

app.get('/api/boards/:boardId/snapshots', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  return access.board.snapshots.map(({ id, title, createdAt }) => ({
    id,
    title,
    createdAt,
  }));
});

app.post('/api/boards/:boardId/snapshots', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  const access = getAccess(boardId, user.id);
  if (!access || access.role === 'viewer')
    return apiError(reply, 403, 'You cannot create a snapshot.');
  const snapshot = {
    id: randomUUID(),
    title: access.board.title,
    createdAt: new Date().toISOString(),
    objects: Object.values(access.board.objects),
  };
  await change((state) => {
    const snapshots = state.boards[boardId]!.snapshots;
    snapshots.push(snapshot);
    if (snapshots.length > 50) snapshots.shift();
  });
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
    const access = getAccess(boardId, user.id);
    if (!access || access.role !== 'owner')
      return apiError(reply, 403, 'Only the owner can restore a snapshot.');
    const snapshot = access.board.snapshots.find(
      (item) => item.id === snapshotId,
    );
    if (!snapshot) return apiError(reply, 404, 'Snapshot not found.');
    await change((state) => {
      const board = state.boards[boardId]!;
      board.deletedObjectIds.push(...Object.keys(board.objects));
      board.objects = {};
      for (const object of snapshot.objects) {
        const restored = { ...object, id: randomUUID() };
        board.objects[restored.id] = restored;
      }
      board.revision += 1;
      board.updatedAt = new Date().toISOString();
    });
    publish(boardId, {
      type: 'reset',
      board: publicBoard(access.board, access.role),
    });
    return publicBoard(access.board, access.role);
  },
);

app.post('/api/boards/:boardId/presence', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return;
  const { boardId } = request.params as { boardId: string };
  if (!getAccess(boardId, user.id))
    return apiError(reply, 404, 'Board not found.');
  const body = z
    .object({
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      color: colorSchema.default('#39846a'),
    })
    .safeParse(request.body);
  if (!body.success) return apiError(reply, 400, 'Invalid cursor location.');
  const board = getBoard(boardId)!;
  updatePresence(boardId, {
    userId: user.id,
    name: board.members[user.id]!.name,
    color: body.data.color,
    ...(body.data.x === undefined ? {} : { x: body.data.x }),
    ...(body.data.y === undefined ? {} : { y: body.data.y }),
    updatedAt: Date.now(),
  });
  return { ok: true };
});

app.get('/api/boards/:boardId/events', async (request, reply) => {
  const user = currentUser(request, reply);
  if (!user) return apiError(reply, 401, 'Your session expired.');
  const { boardId } = request.params as { boardId: string };
  const access = getAccess(boardId, user.id);
  if (!access) return apiError(reply, 404, 'Board not found.');
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  addStream(boardId, reply);
  reply.raw.write(
    `data: ${JSON.stringify({ type: 'snapshot', board: publicBoard(access.board, access.role), peers: peers(boardId) })}\n\n`,
  );
  const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
  reply.raw.on('close', () => clearInterval(heartbeat));
});

app.get('/health', async () => ({ status: 'ok', service: 'collabboard-api' }));

try {
  await loadState();
  await app.listen({ port: config.serverPort, host: config.serverHost });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
