import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Redis } from 'ioredis';
import { WebSocket, WebSocketServer } from 'ws';
import { sameOrigin, userFromRequest } from './auth.js';
import { canEdit, editBlockedReason, publicBoard } from './boards.js';
import { config } from './config.js';
import type {
  BoardMeta,
  BoardObject,
  ChatMessage,
  Operation,
  Presence,
  Role,
  User,
} from './models.js';
import { clientMessageSchema, type ClientMessage } from './schemas.js';
import { redis, store } from './store.js';

/**
 * Board rooms over WebSockets.
 *
 * Each server instance delivers messages to its own sockets directly. Vercel
 * may place two people in the same room on different instances, so messages
 * are also relayed through Redis pub/sub — but only while another instance
 * actually has that room open, which keeps Redis traffic near zero for the
 * common single-instance case.
 */

type Connection = {
  socket: WebSocket;
  peerId: string;
  user: User;
  boardId: string;
  role: Role;
  board: BoardMeta;
  color: string;
  inCall: boolean;
  muted: boolean;
  presenceWrittenAt: number;
};

type Envelope =
  | { o: string; k: 'msg'; d: string; x?: string; to?: string }
  | { o: string; k: 'meta'; d: BoardMeta }
  | { o: string; k: 'hello' };

const instanceId = randomUUID();
const rooms = new Map<string, Set<Connection>>();
const channel = (boardId: string) => `room:${boardId}`;
const PRESENCE_REFRESH_MS = 15_000;
const REMOTE_CHECK_MS = 3_000;

let subscriber: Redis | undefined;
// Whether another instance has this room open, and when that was last checked.
const remoteRooms = new Map<string, { present: boolean; checkedAt: number }>();

function getSubscriber() {
  if (!redis) return;
  if (subscriber) return subscriber;
  subscriber = redis.duplicate();
  subscriber.on('message', (name: string, raw: string) => {
    const boardId = name.slice('room:'.length);
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    if (envelope.o === instanceId) return;
    remoteRooms.set(boardId, { present: true, checkedAt: Date.now() });
    if (envelope.k === 'msg')
      deliverLocal(boardId, envelope.d, {
        ...(envelope.x ? { exceptPeer: envelope.x } : {}),
        ...(envelope.to ? { to: envelope.to } : {}),
      });
    else if (envelope.k === 'meta') deliverMeta(boardId, envelope.d);
  });
  return subscriber;
}

function hasRemoteListeners(boardId: string) {
  if (!redis) return false;
  const known = remoteRooms.get(boardId);
  const now = Date.now();
  if (!known || now - known.checkedAt > REMOTE_CHECK_MS) {
    remoteRooms.set(boardId, {
      present: known?.present ?? true,
      checkedAt: now,
    });
    void redis
      .call('PUBSUB', 'NUMSUB', channel(boardId))
      .then((result) => {
        const count = Number((result as [string, number])[1] ?? 0);
        const ownSubscription = rooms.has(boardId) ? 1 : 0;
        remoteRooms.set(boardId, {
          present: count > ownSubscription,
          checkedAt: Date.now(),
        });
      })
      .catch(() => undefined);
  }
  // Until the first check answers, assume someone may be listening.
  return known?.present ?? true;
}

function send(connection: Connection, data: string) {
  if (connection.socket.readyState === WebSocket.OPEN)
    connection.socket.send(data);
}

function deliverLocal(
  boardId: string,
  data: string,
  options: { exceptPeer?: string; to?: string } = {},
) {
  for (const connection of rooms.get(boardId) ?? []) {
    if (options.exceptPeer && connection.peerId === options.exceptPeer)
      continue;
    if (options.to && connection.peerId !== options.to) continue;
    send(connection, data);
  }
}

function deliverMeta(boardId: string, board: BoardMeta) {
  for (const connection of rooms.get(boardId) ?? []) {
    const member = board.members[connection.user.id];
    if (!member) {
      send(
        connection,
        JSON.stringify({
          t: 'error',
          message: 'You were removed from this board.',
        }),
      );
      connection.socket.close(4403, 'removed');
      continue;
    }
    connection.board = board;
    connection.role = member.role;
    send(
      connection,
      JSON.stringify({ t: 'board', board: publicBoard(board, member.role) }),
    );
  }
}

/** Sends a message to everyone in a room, on every instance. */
export function broadcast(
  boardId: string,
  message: unknown,
  options: { exceptPeer?: string; to?: string } = {},
) {
  const data = JSON.stringify(message);
  deliverLocal(boardId, data, options);
  if (redis && hasRemoteListeners(boardId)) {
    const envelope: Envelope = {
      o: instanceId,
      k: 'msg',
      d: data,
      ...(options.exceptPeer ? { x: options.exceptPeer } : {}),
      ...(options.to ? { to: options.to } : {}),
    };
    void redis.publish(channel(boardId), JSON.stringify(envelope));
  }
}

/** Tells every connected member about new board settings or membership. */
export function broadcastBoard(board: BoardMeta) {
  deliverMeta(board.id, board);
  if (redis && hasRemoteListeners(board.id))
    void redis.publish(
      channel(board.id),
      JSON.stringify({ o: instanceId, k: 'meta', d: board } satisfies Envelope),
    );
}

async function broadcastPresence(boardId: string) {
  const peers = await store.listPresence(boardId);
  broadcast(boardId, { t: 'presence', peers });
}

function presenceOf(connection: Connection): Presence {
  return {
    peerId: connection.peerId,
    userId: connection.user.id,
    name: connection.user.name,
    color: connection.color,
    inCall: connection.inCall,
    muted: connection.muted,
    updatedAt: Date.now(),
  };
}

async function joinRoom(connection: Connection) {
  let room = rooms.get(connection.boardId);
  if (!room) {
    rooms.set(connection.boardId, (room = new Set()));
    const sub = getSubscriber();
    if (sub && redis) {
      await sub.subscribe(channel(connection.boardId));
      // Let instances already serving this room know to start relaying.
      void redis.publish(
        channel(connection.boardId),
        JSON.stringify({ o: instanceId, k: 'hello' } satisfies Envelope),
      );
      remoteRooms.delete(connection.boardId);
    }
  }
  // A reconnecting tab keeps its peerId; drop the stale socket.
  for (const existing of room)
    if (existing.peerId === connection.peerId) {
      room.delete(existing);
      existing.socket.close(4409, 'replaced');
    }
  room.add(connection);
}

async function leaveRoom(connection: Connection) {
  const room = rooms.get(connection.boardId);
  if (!room?.delete(connection)) return;
  if (room.size === 0) {
    rooms.delete(connection.boardId);
    remoteRooms.delete(connection.boardId);
    await subscriber
      ?.unsubscribe(channel(connection.boardId))
      .catch(() => undefined);
  }
  await store.removePresence(connection.boardId, connection.peerId);
  await broadcastPresence(connection.boardId);
}

async function handleOperation(connection: Connection, op: Operation) {
  const reply = (message: unknown) => send(connection, JSON.stringify(message));
  if (!canEdit(connection.role, connection.board))
    return reply({
      t: 'nack',
      id: op.id,
      message: editBlockedReason(connection.role, connection.board),
    });
  if (
    (op.object?.src !== undefined || op.fields?.src !== undefined) &&
    (op.object?.src ?? op.fields?.src ?? '').length > 800_000
  )
    return reply({ t: 'nack', id: op.id, message: 'That image is too large.' });
  // Peers see the change before the write finishes; the write is atomic and
  // idempotent, so a retried operation cannot apply twice.
  broadcast(
    connection.boardId,
    { t: 'op', op, by: connection.peerId },
    { exceptPeer: connection.peerId },
  );
  try {
    await store.applyOperation(connection.boardId, op);
    reply({ t: 'ack', id: op.id });
  } catch (error) {
    console.error('Failed to save operation', error);
    reply({
      t: 'nack',
      id: op.id,
      message: 'Could not save that change.',
      retry: true,
    });
  }
}

async function handleMessage(connection: Connection, message: ClientMessage) {
  const { boardId, peerId } = connection;
  switch (message.t) {
    case 'op':
      return handleOperation(connection, message.op as Operation);
    case 'live': {
      // Viewers may share their cursor, but not draw.
      const live = canEdit(connection.role, connection.board)
        ? message
        : { t: 'live' as const, cursor: message.cursor };
      if (
        live.cursor === undefined &&
        !('upsert' in live || 'append' in live || 'remove' in live)
      )
        return;
      return broadcast(boardId, { ...live, peerId }, { exceptPeer: peerId });
    }
    case 'typing':
      return broadcast(
        boardId,
        { t: 'typing', peerId, name: presenceOf(connection).name },
        { exceptPeer: peerId },
      );
    case 'chat': {
      const chat: ChatMessage = {
        id: randomUUID(),
        userId: connection.user.id,
        name: presenceOf(connection).name,
        text: message.text,
        createdAt: new Date().toISOString(),
      };
      broadcast(boardId, {
        t: 'chat',
        message: chat,
        clientId: message.clientId,
      });
      await store.addMessage(boardId, chat);
      return;
    }
    case 'call':
      connection.inCall = message.inCall;
      connection.muted = message.muted;
      await store.setPresence(boardId, presenceOf(connection));
      connection.presenceWrittenAt = Date.now();
      return broadcastPresence(boardId);
    case 'signal':
      return broadcast(
        boardId,
        { t: 'signal', from: peerId, data: message.data },
        { to: message.to },
      );
    case 'ping':
      send(connection, '{"t":"pong"}');
      if (Date.now() - connection.presenceWrittenAt > PRESENCE_REFRESH_MS) {
        connection.presenceWrittenAt = Date.now();
        await store.setPresence(boardId, presenceOf(connection));
      }
      return;
    case 'hello':
      return;
  }
}

async function authenticate(
  socket: WebSocket,
  user: User,
  hello: Extract<ClientMessage, { t: 'hello' }>,
): Promise<Connection | string> {
  const board = await store.getMeta(hello.boardId);
  const member = board?.members[user.id];
  if (!board || !member) return 'Board not found or you do not have access.';
  return {
    socket,
    peerId: hello.peerId,
    user,
    boardId: board.id,
    role: member.role,
    board,
    color: user.color,
    inCall: hello.inCall ?? false,
    muted: hello.muted ?? false,
    presenceWrittenAt: Date.now(),
  };
}

function onConnection(socket: WebSocket, user: User) {
  let connection: Connection | undefined;
  let pending: Promise<void> = Promise.resolve();
  const helloTimer = setTimeout(() => socket.close(4401, 'no hello'), 10_000);

  socket.on('message', (raw) => {
    let parsed;
    try {
      parsed = clientMessageSchema.safeParse(JSON.parse(raw.toString()));
    } catch {
      return;
    }
    if (!parsed.success) {
      const id = (parsed.data as { op?: { id?: string } } | undefined)?.op?.id;
      if (id)
        socket.send(
          JSON.stringify({ t: 'nack', id, message: 'Invalid canvas update.' }),
        );
      return;
    }
    const message = parsed.data;
    // Handle messages in arrival order so a stroke's points never overtake it.
    pending = pending
      .then(async () => {
        if (message.t === 'hello') {
          if (connection) return;
          const result = await authenticate(socket, user, message);
          clearTimeout(helloTimer);
          if (typeof result === 'string') {
            socket.send(
              JSON.stringify({ t: 'error', message: result, fatal: true }),
            );
            socket.close(4403, 'forbidden');
            return;
          }
          connection = result;
          await joinRoom(connection);
          await store.setPresence(connection.boardId, presenceOf(connection));
          const [objects, messages, peers] = await Promise.all([
            store.getObjects(connection.boardId),
            store.getMessages(connection.boardId),
            store.listPresence(connection.boardId),
          ]);
          send(
            connection,
            JSON.stringify({
              t: 'welcome',
              board: publicBoard(connection.board, connection.role),
              objects: objects satisfies BoardObject[],
              messages,
              peers,
              self: { peerId: connection.peerId, userId: connection.user.id },
              iceServers: config.iceServers,
            }),
          );
          broadcast(
            connection.boardId,
            { t: 'presence', peers },
            { exceptPeer: connection.peerId },
          );
          return;
        }
        if (connection) await handleMessage(connection, message);
      })
      .catch((error) => console.error('Realtime message failed', error));
  });

  socket.on('close', () => {
    clearTimeout(helloTimer);
    if (connection) {
      const closing = connection;
      pending = pending.then(() => leaveRoom(closing)).catch(() => undefined);
    }
  });
  socket.on('error', () => undefined);
}

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2_000_000,
    perMessageDeflate: false,
  });
  server.on(
    'upgrade',
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = (request.url ?? '').split('?')[0];
      const reject = (status: string) => {
        socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
      };
      if (path !== '/api/ws') return reject('404 Not Found');
      // The session cookie authenticates the socket, so only this site's
      // pages may open one.
      if (!sameOrigin(request)) return reject('403 Forbidden');
      userFromRequest(request)
        .then((user) => {
          if (!user) return reject('401 Unauthorized');
          wss.handleUpgrade(request, socket, head, (ws) =>
            onConnection(ws, user),
          );
        })
        .catch(() => reject('500 Internal Server Error'));
    },
  );
  return wss;
}
