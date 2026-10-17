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
 * are also relayed through Redis pub/sub — but only while someone in the room
 * is connected to another instance, which keeps Redis traffic near zero for
 * the common single-instance case. Each presence record names its instance.
 * (PUBSUB NUMSUB can't be used for this: on Upstash it only counts the
 * subscribers of whichever node answers, so it often reports zero.)
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
  /** Saves run one after another so a connection's edits land in order. */
  writes: Promise<unknown>;
  /** Presence and chat saves, kept apart so they never wait on edits. */
  chores: Promise<unknown>;
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
/** Hearing from another instance keeps relaying on at least this long. */
const REMOTE_HEARD_MS = 20_000;

let subscriber: Redis | undefined;
// Whether another instance has this room open, and when that was last checked.
const remoteRooms = new Map<
  string,
  { present: boolean; checkedAt: number; heardAt: number }
>();

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
    const known = remoteRooms.get(boardId);
    remoteRooms.set(boardId, {
      present: true,
      checkedAt: known?.checkedAt ?? Date.now(),
      heardAt: Date.now(),
    });
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
      heardAt: known?.heardAt ?? 0,
    });
    void store
      .listPresence(boardId)
      .then((peers) => {
        const current = remoteRooms.get(boardId);
        const heardAt = current?.heardAt ?? 0;
        remoteRooms.set(boardId, {
          // Records from before instances were tracked count as remote.
          present:
            peers.some((peer) => peer.instance !== instanceId) ||
            Date.now() - heardAt < REMOTE_HEARD_MS,
          checkedAt: Date.now(),
          heardAt,
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
    instance: instanceId,
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
    if (
      existing.peerId === connection.peerId &&
      existing.user.id === connection.user.id
    ) {
      room.delete(existing);
      existing.socket.close(4409, 'replaced');
    }
  room.add(connection);
}

/**
 * `handedOver` means the tab already opened a replacement connection, maybe
 * on another instance, so its presence must stay.
 */
async function leaveRoom(connection: Connection, handedOver = false) {
  const room = rooms.get(connection.boardId);
  if (!room?.delete(connection)) return;
  if (room.size === 0) {
    rooms.delete(connection.boardId);
    remoteRooms.delete(connection.boardId);
    await subscriber
      ?.unsubscribe(channel(connection.boardId))
      .catch(() => undefined);
  }
  if (handedOver) return;
  await store.removePresence(connection.boardId, connection.peerId);
  await broadcastPresence(connection.boardId);
}

/** Queues background work for a connection, keeping its order. */
function chore(connection: Connection, work: () => Promise<unknown>) {
  connection.chores = connection.chores
    .then(work)
    .catch((error) => console.error('Realtime save failed', error));
}

function handleOperation(connection: Connection, op: Operation) {
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
  // idempotent, so a retried operation cannot apply twice. Saving happens off
  // the message path: waiting on the database here would hold back the live
  // strokes queued behind this edit, which is what made fast writing and
  // erasing arrive in bursts.
  broadcast(
    connection.boardId,
    { t: 'op', op, by: connection.peerId },
    { exceptPeer: connection.peerId },
  );
  connection.writes = connection.writes.then(async () => {
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
  });
}

/** Handles one message without waiting on storage, so nothing queues behind it. */
function handleMessage(connection: Connection, message: ClientMessage) {
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
      return chore(connection, () => store.addMessage(boardId, chat));
    }
    case 'call':
      connection.inCall = message.inCall;
      connection.muted = message.muted;
      connection.presenceWrittenAt = Date.now();
      return chore(connection, async () => {
        await store.setPresence(boardId, presenceOf(connection));
        await broadcastPresence(boardId);
      });
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
        chore(connection, () =>
          store.setPresence(boardId, presenceOf(connection)),
        );
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
  // Peer IDs are random per tab, and others in the room can see them. Only
  // the same person may take one over, so nobody can knock someone else out
  // of the room or receive the call signals meant for them.
  const peerOwner = (await store.listPresence(board.id)).find(
    (peer) => peer.peerId === hello.peerId,
  )?.userId;
  const localOwner = [...(rooms.get(board.id) ?? [])].find(
    (existing) => existing.peerId === hello.peerId,
  )?.user.id;
  if ((peerOwner ?? user.id) !== user.id || (localOwner ?? user.id) !== user.id)
    return 'This connection is already in use. Reload the page to rejoin.';
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
    writes: Promise.resolve(),
    chores: Promise.resolve(),
  };
}

/** A tab closes its old connection with this code once a new one is live. */
const HANDED_OVER = 4001;

function onConnection(socket: WebSocket, user: User) {
  let connection: Connection | undefined;
  let joining: Promise<void> | undefined;
  // Messages that arrive while the hello is still being checked.
  const early: ClientMessage[] = [];
  const helloTimer = setTimeout(() => socket.close(4401, 'no hello'), 10_000);

  async function join(hello: Extract<ClientMessage, { t: 'hello' }>) {
    const result = await authenticate(socket, user, hello);
    clearTimeout(helloTimer);
    if (typeof result === 'string') {
      socket.send(JSON.stringify({ t: 'error', message: result, fatal: true }));
      socket.close(4403, 'forbidden');
      return;
    }
    const joined = result;
    await joinRoom(joined);
    await store.setPresence(joined.boardId, presenceOf(joined));
    const [objects, messages, peers] = await Promise.all([
      store.getObjects(joined.boardId),
      store.getMessages(joined.boardId),
      store.listPresence(joined.boardId),
    ]);
    send(
      joined,
      JSON.stringify({
        t: 'welcome',
        board: publicBoard(joined.board, joined.role),
        objects: objects satisfies BoardObject[],
        messages,
        peers,
        self: { peerId: joined.peerId, userId: joined.user.id },
        iceServers: config.iceServers,
      }),
    );
    broadcast(
      joined.boardId,
      { t: 'presence', peers },
      { exceptPeer: joined.peerId },
    );
    connection = joined;
    // Handle anything sent meanwhile in arrival order, so a stroke's points
    // never overtake it.
    for (const message of early.splice(0)) handleMessage(joined, message);
  }

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
    if (message.t === 'hello') {
      joining ??= join(message).catch((error) =>
        console.error('Realtime join failed', error),
      );
      return;
    }
    if (connection) handleMessage(connection, message);
    else if (joining) early.push(message);
  });

  socket.on('close', (code) => {
    clearTimeout(helloTimer);
    void (joining ?? Promise.resolve())
      .then(() => {
        if (connection) return leaveRoom(connection, code === HANDED_OVER);
      })
      .catch(() => undefined);
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
