import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Redis } from 'ioredis';
import { WebSocket, WebSocketServer } from 'ws';
import { sameOrigin, userFromRequest } from './auth.js';
import {
  boardTier,
  canEdit,
  editBlockedReason,
  openToOthers,
  premiumUnlocked,
  publicBoard,
} from './boards.js';
import { config } from './config.js';
import {
  TRIAL_GUESTS,
  type BoardMeta,
  type BoardObject,
  type ChatMessage,
  type Operation,
  type AudioTrack,
  type Plan,
  type Presence,
  type Role,
  type Tier,
  type User,
} from './models.js';
import {
  clientMessageSchema,
  srcAllowedOn,
  type ClientMessage,
} from './schemas.js';
import { sfuConfigured, validSessionToken } from './sfu.js';
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
  /** Their microphone on the SFU while they are in the call. */
  audio: AudioTrack | undefined;
  away: boolean;
  presenceWrittenAt: number;
  /** When the browser was last heard from: any message, or a pong. */
  heard: Heard;
  /** Saves run one after another so a connection's edits land in order. */
  writes: Promise<unknown>;
  /** Presence and chat saves, kept apart so they never wait on edits. */
  chores: Promise<unknown>;
};

type Heard = { at: number; pongAt: number };

type Envelope =
  | { o: string; k: 'msg'; d: string; x?: string; to?: string }
  | { o: string; k: 'meta'; d: BoardMeta }
  | { o: string; k: 'hello' }
  // Several of the above, published together.
  | { o: string; k: 'batch'; d: Envelope[] };

const instanceId = randomUUID();
const rooms = new Map<string, Set<Connection>>();
const channel = (boardId: string) => `room:${boardId}`;
const PRESENCE_REFRESH_MS = 15_000;
/**
 * Every few seconds each socket is pinged. Browsers answer pings from the
 * network stack even in background tabs, so a socket that stops answering
 * belongs to a closed laptop, a lost network, or a tab the OS suspended, and
 * is dropped so everyone else sees that person go offline.
 */
const SWEEP_EVERY_MS = 3_000;
const SILENT_AFTER_MS = 10_000;
/** Without pongs (a proxy may answer them itself), app pings must arrive. */
const SILENT_NO_PONG_MS = 75_000;
/** A tab that handed its connection over has this long to show up again. */
const HANDOVER_GRACE_MS = 5_000;
/** How often rooms shared with other instances re-check for expired peers. */
const REMOTE_PRESENCE_CHECK_MS = 10_000;
const REMOTE_CHECK_MS = 3_000;
/**
 * While no other instance has the room, checking is only a fallback: an
 * instance that opens the room announces itself, which starts relaying at
 * once. Each check is a Redis command, so it runs far less often.
 */
const REMOTE_ABSENT_CHECK_MS = 30_000;
/** Hearing from another instance keeps relaying on at least this long. */
const REMOTE_HEARD_MS = 20_000;

let subscriber: Redis | undefined;
let subscriberReady: Promise<Redis> | undefined;
// Whether another instance has this room open, and when that was last checked.
const remoteRooms = new Map<
  string,
  { present: boolean; checkedAt: number; heardAt: number }
>();

/**
 * The connection rooms subscribe on, once it is ready. Subscribing earlier
 * races ioredis's own ready check: the SUBSCRIBE can reach Redis before its
 * INFO, which then fails, and the joins waiting on it failed with it.
 */
function getSubscriber() {
  if (!redis) return;
  if (subscriberReady) return subscriberReady;
  subscriber = redis.duplicate();
  const connection = subscriber;
  subscriberReady = new Promise<Redis>((resolve) => {
    if (connection.status === 'ready') resolve(connection);
    else connection.once('ready', () => resolve(connection));
  });
  subscriber.on('error', (error: Error) =>
    console.error('Realtime relay connection error', error.message),
  );
  subscriber.on('message', (name: string, raw: string) => {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    if (envelope.o === instanceId) return;
    const boardId = name.slice('room:'.length);
    if (envelope.k === 'batch')
      for (const item of envelope.d) receiveEnvelope(boardId, item);
    else receiveEnvelope(boardId, envelope);
  });
  return subscriberReady;
}

/** Handles one message relayed from another instance. */
function receiveEnvelope(boardId: string, envelope: Envelope) {
  const known = remoteRooms.get(boardId);
  remoteRooms.set(boardId, {
    present: true,
    checkedAt: known?.checkedAt ?? Date.now(),
    heardAt: Date.now(),
  });
  if (envelope.k === 'msg' && envelope.d.startsWith('{"t":"presence"'))
    try {
      notePresence(
        boardId,
        (JSON.parse(envelope.d) as { peers: Presence[] }).peers,
      );
    } catch {
      // Delivered as is below.
    }
  if (envelope.k === 'msg')
    deliverLocal(boardId, envelope.d, {
      ...(envelope.x ? { exceptPeer: envelope.x } : {}),
      ...(envelope.to ? { to: envelope.to } : {}),
    });
  else if (envelope.k === 'meta') deliverMeta(boardId, envelope.d);
}

/** Relay messages waiting to be published, per room. */
const outbox = new Map<string, Envelope[]>();

/**
 * Publishes to the room's other instances. Everything queued for a room in
 * the same turn of the event loop goes out as one PUBLISH: a busy room
 * streams a message per person per frame, and each publish is a billed
 * Redis command. Nothing waits for a timer, so relayed strokes are not
 * delayed.
 */
function relay(boardId: string, envelope: Envelope) {
  if (!redis) return;
  let queue = outbox.get(boardId);
  if (!queue) {
    outbox.set(boardId, (queue = []));
    setImmediate(() => {
      outbox.delete(boardId);
      void redis?.publish(
        channel(boardId),
        JSON.stringify(
          queue!.length === 1
            ? queue![0]
            : ({ o: instanceId, k: 'batch', d: queue! } satisfies Envelope),
        ),
      );
    });
  }
  queue.push(envelope);
}

function hasRemoteListeners(boardId: string) {
  if (!redis) return false;
  const known = remoteRooms.get(boardId);
  const now = Date.now();
  const every =
    known?.present === false ? REMOTE_ABSENT_CHECK_MS : REMOTE_CHECK_MS;
  if (!known || now - known.checkedAt > every) {
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
    relay(boardId, envelope);
  }
}

/** Tells every connected member about new board settings or membership. */
export function broadcastBoard(board: BoardMeta) {
  deliverMeta(board.id, board);
  if (redis && hasRemoteListeners(board.id))
    relay(board.id, { o: instanceId, k: 'meta', d: board });
}

/** What each room's presence looked like when last listed on this instance. */
const roomPresence = new Map<
  string,
  { signature: string; remote: boolean; checkedAt: number }
>();

function notePresence(boardId: string, peers: Presence[]) {
  const signature = peers
    .map((peer) => `${peer.peerId}:${peer.inCall}:${peer.muted}:${peer.away}`)
    .sort()
    .join('|');
  const changed = roomPresence.get(boardId)?.signature !== signature;
  roomPresence.set(boardId, {
    signature,
    remote: peers.some((peer) => peer.instance !== instanceId),
    checkedAt: Date.now(),
  });
  return changed;
}

async function broadcastPresence(boardId: string) {
  const peers = await store.listPresence(boardId);
  notePresence(boardId, peers);
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
    ...(connection.away ? { away: true } : {}),
    ...(connection.inCall && connection.audio
      ? { audio: connection.audio }
      : {}),
    updatedAt: Date.now(),
    instance: instanceId,
  };
}

async function joinRoom(connection: Connection) {
  let room = rooms.get(connection.boardId);
  if (!room) {
    rooms.set(connection.boardId, (room = new Set()));
    // So the sweep notices the tier change even if it ends before it runs.
    roomTiers.set(connection.boardId, boardTier(connection.board));
    const ready = getSubscriber();
    if (ready && redis) {
      try {
        await (await ready).subscribe(channel(connection.boardId));
      } catch (error) {
        // Without its subscription this instance would never hear the
        // room's other instances, so let the next join try again.
        if (!rooms.get(connection.boardId)?.size) {
          rooms.delete(connection.boardId);
          roomTiers.delete(connection.boardId);
        }
        throw error;
      }
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
    roomPresence.delete(connection.boardId);
    roomTiers.delete(connection.boardId);
    trialCounted.delete(connection.boardId);
    await subscriber
      ?.unsubscribe(channel(connection.boardId))
      .catch(() => undefined);
  }
  if (handedOver) {
    // The replacement normally joined before this close. If it never shows
    // up (the tab closed mid-handover), drop the presence this socket left.
    setTimeout(() => {
      const local = [...(rooms.get(connection.boardId) ?? [])].some(
        (other) => other.peerId === connection.peerId,
      );
      if (local) return;
      void store
        .listPresence(connection.boardId)
        .then(async (peers) => {
          const record = peers.find(
            (peer) => peer.peerId === connection.peerId,
          );
          // A record from another instance means the tab moved there.
          if (record?.instance !== instanceId) return;
          await store.removePresence(connection.boardId, connection.peerId);
          await broadcastPresence(connection.boardId);
        })
        .catch(() => undefined);
    }, HANDOVER_GRACE_MS).unref?.();
    return;
  }
  await store.removePresence(connection.boardId, connection.peerId);
  await broadcastPresence(connection.boardId);
}

/**
 * Drops sockets that stopped answering, keeps live presence fresh (so a tab
 * whose timers the browser throttles in the background stays listed), and
 * notices peers on other instances whose presence expired.
 */
/** Each room's tier when last swept, to notice the moment it changes. */
const roomTiers = new Map<string, Tier>();

/** Close code for people sent away because the owner's plan ran out. */
const OWNER_PLAN_ENDED = 4402;

/**
 * Applies the owner's plan as it changes: when the trial or a paid month ends,
 * everyone but the owner is disconnected, and the owner's pages learn what
 * the free plan now allows.
 */
function enforceTier(boardId: string, room: Set<Connection>, now: number) {
  const first = room.values().next().value;
  if (!first) return;
  const tier = boardTier(first.board, now);
  const before = roomTiers.get(boardId);
  roomTiers.set(boardId, tier);
  if (tier === 'free')
    for (const connection of room) {
      if (connection.user.id === connection.board.ownerId) continue;
      send(
        connection,
        JSON.stringify({
          t: 'error',
          message:
            'The owner’s free trial has ended, so this board is closed to others for now.',
          fatal: true,
          code: 'owner_plan_ended',
        }),
      );
      connection.socket.close(OWNER_PLAN_ENDED, 'owner plan ended');
    }
  if (before && before !== tier)
    for (const connection of room)
      if (connection.user.id === connection.board.ownerId)
        send(
          connection,
          JSON.stringify({
            t: 'board',
            board: publicBoard(connection.board, connection.role),
          }),
        );
}

/** How often an open trial board counts towards its owner's trial. */
const TRIAL_COUNT_EVERY_MS = 10_000;
/** When each room last counted towards its owner's trial. */
const trialCounted = new Map<string, number>();

/**
 * A trial board in use counts towards its owner's 30 minutes of active use,
 * whoever is using it: otherwise an owner could open a board, invite two
 * people, and leave them using it for free. Nobody visible, nothing counts.
 */
function countTrial(boardId: string, room: Set<Connection>, now: number) {
  const first = room.values().next().value;
  if (!first || boardTier(first.board, now) !== 'trial') {
    trialCounted.delete(boardId);
    return;
  }
  if (now - (trialCounted.get(boardId) ?? 0) < TRIAL_COUNT_EVERY_MS) return;
  if (![...room].some((connection) => !connection.away)) return;
  trialCounted.set(boardId, now);
  const ownerId = first.board.ownerId;
  void store
    .accrueTrial(ownerId)
    .then((plan) => plan && refreshOwnerPlan(ownerId, plan))
    .catch(() => undefined);
}

/**
 * Applies an owner's latest plan to the boards they own that are open here,
 * so a trial that just ran out takes effect right away.
 */
export function refreshOwnerPlan(ownerId: string, plan: Plan) {
  const now = Date.now();
  for (const [boardId, room] of rooms) {
    const first = room.values().next().value;
    if (first?.board.ownerId !== ownerId) continue;
    for (const connection of room)
      connection.board = { ...connection.board, ownerPlan: plan };
    enforceTier(boardId, room, now);
  }
}

function sweep() {
  const now = Date.now();
  for (const [boardId, room] of rooms) {
    countTrial(boardId, room, now);
    enforceTier(boardId, room, now);
    for (const connection of room) {
      const { socket, heard } = connection;
      if (socket.readyState !== WebSocket.OPEN) continue;
      const lastHeard = Math.max(heard.at, heard.pongAt);
      if (
        (heard.pongAt && now - lastHeard > SILENT_AFTER_MS) ||
        now - lastHeard > SILENT_NO_PONG_MS
      ) {
        // The close handler leaves the room and tells everyone.
        socket.terminate();
        continue;
      }
      socket.ping();
      if (now - connection.presenceWrittenAt > PRESENCE_REFRESH_MS) {
        connection.presenceWrittenAt = now;
        chore(connection, () =>
          store.setPresence(boardId, presenceOf(connection)),
        );
      }
    }
    const known = roomPresence.get(boardId);
    if (known?.remote && now - known.checkedAt > REMOTE_PRESENCE_CHECK_MS) {
      known.checkedAt = now;
      void store
        .listPresence(boardId)
        .then((peers) => {
          // Each instance tells its own sockets; the others do the same.
          if (notePresence(boardId, peers))
            deliverLocal(boardId, JSON.stringify({ t: 'presence', peers }));
        })
        .catch(() => undefined);
    }
  }
}

let sweeping: ReturnType<typeof setInterval> | undefined;
function startSweeping() {
  sweeping ??= setInterval(sweep, SWEEP_EVERY_MS);
  sweeping.unref?.();
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
  // Uploaded images are only shown on the board they were uploaded to, so
  // one board can't point at (or keep alive) another board's files.
  if (!srcAllowedOn(connection.boardId, op.object?.src ?? op.fields?.src))
    return reply({
      t: 'nack',
      id: op.id,
      message: 'That image isn’t on this board.',
    });
  // New images are a Premium feature. Uploads are checked by the upload
  // route; images embedded inline would skip it, so they are checked here.
  if (
    (op.object?.src ?? op.fields?.src ?? '').startsWith('data:') &&
    !premiumUnlocked(connection.board, connection.user)
  )
    return reply({
      t: 'nack',
      id: op.id,
      message: 'Adding images is a Premium feature.',
    });
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
        ? {
            ...message,
            ...(message.upsert && {
              upsert: message.upsert.filter((object) =>
                srcAllowedOn(boardId, object.src),
              ),
            }),
          }
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
      connection.audio = message.inCall
        ? verifiedAudio(connection.boardId, connection.user, message.audio)
        : undefined;
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
      return;
    case 'away':
      if (connection.away === message.away) return;
      connection.away = message.away;
      connection.presenceWrittenAt = Date.now();
      return chore(connection, async () => {
        await store.setPresence(boardId, presenceOf(connection));
        await broadcastPresence(boardId);
      });
    case 'bye':
      // Leave now rather than when the close reaches us, which a proxy or a
      // closing tab can delay.
      void leaveRoom(connection).catch(() => undefined);
      connection.socket.close(1000, 'bye');
      return;
    case 'hello':
      return;
  }
}

/**
 * A microphone track someone says is theirs, kept only if the server issued
 * its token to this person for this board.
 */
function verifiedAudio(
  boardId: string,
  user: User,
  audio: { session: string; track: string; token: string } | undefined,
): AudioTrack | undefined {
  if (!audio) return;
  if (!validSessionToken(boardId, user.id, audio.session, audio.token)) return;
  return { session: audio.session, track: audio.track };
}

async function authenticate(
  socket: WebSocket,
  user: User,
  hello: Extract<ClientMessage, { t: 'hello' }>,
  heard: Heard,
): Promise<Connection | string> {
  const board = await store.getMeta(hello.boardId);
  const member = board?.members[user.id];
  if (!board || !member) return 'Board not found or you do not have access.';
  // Peer IDs are random per tab, and others in the room can see them. Only
  // the same person may take one over, so nobody can knock someone else out
  // of the room or receive the call signals meant for them.
  const presence = await store.listPresence(board.id);
  const peerOwner = presence.find(
    (peer) => peer.peerId === hello.peerId,
  )?.userId;
  const localOwner = [...(rooms.get(board.id) ?? [])].find(
    (existing) => existing.peerId === hello.peerId,
  )?.user.id;
  if ((peerOwner ?? user.id) !== user.id || (localOwner ?? user.id) !== user.id)
    return 'This connection is already in use. Reload the page to rejoin.';
  if (user.id !== board.ownerId) {
    if (!openToOthers(board))
      return 'This board’s owner is on the free plan, so it isn’t open to others right now.';
    if (boardTier(board) === 'trial') {
      // Two people besides the owner may be in a trial board at once.
      const others = new Set(
        [
          ...presence.map((peer) => peer.userId),
          ...[...(rooms.get(board.id) ?? [])].map((other) => other.user.id),
        ].filter((id) => id !== board.ownerId && id !== user.id),
      );
      if (others.size >= TRIAL_GUESTS)
        return 'This board is full on the free plan. Ask its owner to upgrade to Premium to bring in more people.';
    }
  }
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
    audio: hello.inCall
      ? verifiedAudio(board.id, user, hello.audio)
      : undefined,
    away: hello.away ?? false,
    presenceWrittenAt: Date.now(),
    heard,
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
  const heard: Heard = { at: Date.now(), pongAt: 0 };
  socket.on('pong', () => (heard.pongAt = Date.now()));

  async function join(hello: Extract<ClientMessage, { t: 'hello' }>) {
    const result = await authenticate(socket, user, hello, heard);
    clearTimeout(helloTimer);
    if (typeof result === 'string') {
      socket.send(JSON.stringify({ t: 'error', message: result, fatal: true }));
      socket.close(4403, 'forbidden');
      return;
    }
    const joined = result;
    // The tab may have closed while its hello was being checked.
    if (socket.readyState !== WebSocket.OPEN) return;
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
        // Calls go through the SFU when it is set up, else peer to peer.
        sfu: sfuConfigured(),
      }),
    );
    broadcast(
      joined.boardId,
      { t: 'presence', peers },
      { exceptPeer: joined.peerId },
    );
    connection = joined;
    // The first pong shows pings get through, which arms the quick check.
    socket.ping();
    // Handle anything sent meanwhile in arrival order, so a stroke's points
    // never overtake it.
    for (const message of early.splice(0)) handleMessage(joined, message);
  }

  socket.on('message', (raw) => {
    heard.at = Date.now();
    let input: unknown;
    try {
      input = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const parsed = clientMessageSchema.safeParse(input);
    if (!parsed.success) {
      // A failed parse has no data, so the id comes from the raw message:
      // the sender can then drop the edit instead of retrying it forever.
      const id = (input as { op?: { id?: unknown } } | null)?.op?.id;
      if (typeof id === 'string' && id.length <= 100)
        socket.send(
          JSON.stringify({ t: 'nack', id, message: 'Invalid canvas update.' }),
        );
      return;
    }
    const message = parsed.data;
    if (message.t === 'hello') {
      joining ??= join(message).catch((error) => {
        console.error('Realtime join failed', error);
        // Close rather than leave the tab waiting for a welcome that never
        // comes; it reconnects straight away.
        socket.close(1011, 'join failed');
      });
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
  startSweeping();
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
