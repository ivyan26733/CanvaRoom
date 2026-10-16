import {
  readOutbox,
  writeOutbox,
  type Board,
  type BoardObject,
  type ChatMessage,
  type Operation,
  type Peer,
} from './api';

export type LiveCursor = { x: number; y: number; page?: string };

export type LiveMessage = {
  t: 'live';
  peerId: string;
  cursor?: LiveCursor | null;
  upsert?: BoardObject[];
  append?: { id: string; points: number[] }[];
  remove?: string[];
};

export type ServerMessage =
  | {
      t: 'welcome';
      board: Board;
      objects: BoardObject[];
      messages: ChatMessage[];
      peers: Peer[];
      self: { peerId: string; userId: string };
      iceServers: RTCIceServer[];
    }
  | { t: 'op'; op: Operation; by: string }
  | { t: 'ack'; id: string }
  | { t: 'nack'; id: string; message: string; retry?: boolean }
  | LiveMessage
  | { t: 'chat'; message: ChatMessage; clientId: string }
  | { t: 'typing'; peerId: string; name: string }
  | { t: 'presence'; peers: Peer[] }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'board'; board: Board }
  | { t: 'reset'; objects: BoardObject[] }
  | { t: 'deleted' }
  | { t: 'error'; message: string; fatal?: boolean }
  | { t: 'pong' };

export type ConnectionStatus = 'connecting' | 'live' | 'offline';

type Handlers = {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  /** Called when unsent edits change, so the UI can show a saving state. */
  onPending: (count: number) => void;
};

const PING_EVERY_MS = 10_000;
const DEAD_AFTER_MS = 25_000;
const LIVE_FLUSH_MS = 16;

function realtimeUrl() {
  const override = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (override) return override;
  // `next dev` cannot proxy WebSocket upgrades, so talk to the API directly.
  if (process.env.NODE_ENV === 'development')
    return `ws://${location.hostname}:4000/api/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`;
}

/**
 * One WebSocket per open board.
 *
 * Edits go into a persistent outbox and stay there until the server
 * acknowledges them, so nothing is lost across reconnects or reloads. Live
 * activity (cursor, in-progress strokes, moves, typing) is coalesced and sent
 * at most once per frame.
 */
export class RealtimeClient {
  readonly peerId = crypto.randomUUID();
  status: ConnectionStatus = 'connecting';
  private socket: WebSocket | null = null;
  private outbox: Operation[];
  private closed = false;
  private retryDelay = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private lastHeard = Date.now();
  private call = { inCall: false, muted: false };
  private live: {
    cursor?: LiveCursor | null;
    upsert?: BoardObject[] | undefined;
    append?: { id: string; points: number[] }[] | undefined;
    remove?: string[];
  } = {};
  private liveTimer: ReturnType<typeof setTimeout> | undefined;
  private appendIndex = new Map<string, number[]>();

  constructor(
    private readonly boardId: string,
    private readonly userId: string,
    private readonly color: string,
    private readonly handlers: Handlers,
  ) {
    this.outbox = readOutbox(this.outboxKey);
    this.connect();
    window.addEventListener('online', this.reconnectNow);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  /** Unsent edits belong to one person on one board. */
  private get outboxKey() {
    return `${this.userId}.${this.boardId}`;
  }

  get pendingOperations() {
    return this.outbox;
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.status = status;
    this.handlers.onStatus(status);
  }

  private connect() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.setStatus(this.status === 'live' ? 'connecting' : this.status);
    const socket = new WebSocket(realtimeUrl());
    this.socket = socket;
    socket.onopen = () => {
      this.lastHeard = Date.now();
      socket.send(
        JSON.stringify({
          t: 'hello',
          boardId: this.boardId,
          peerId: this.peerId,
          color: this.color,
          ...this.call,
        }),
      );
    };
    socket.onmessage = (event) => {
      this.lastHeard = Date.now();
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (message.t === 'welcome') {
        this.retryDelay = 0;
        this.setStatus('live');
        this.handlers.onMessage(message);
        // Replay anything the server has not confirmed. Operations are
        // idempotent, so a replay of an applied edit is harmless.
        for (const op of this.outbox) this.rawSend({ t: 'op', op });
        this.startPing();
        return;
      }
      if (message.t === 'ack' || message.t === 'nack') {
        if (message.t === 'nack' && message.retry) return;
        this.outbox = this.outbox.filter((op) => op.id !== message.id);
        writeOutbox(this.outboxKey, this.outbox);
        this.handlers.onPending(this.outbox.length);
      }
      if (message.t === 'error' && message.fatal) this.closed = true;
      this.handlers.onMessage(message);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.pingTimer);
      if (this.closed) return;
      this.setStatus('offline');
      // Vercel ends long connections at the function's max duration; the
      // first retry is immediate so that is invisible to people drawing.
      this.retryTimer = setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(8000, Math.max(500, this.retryDelay * 2));
    };
    socket.onerror = () => socket.close();
  }

  private startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastHeard > DEAD_AFTER_MS) {
        this.socket?.close();
        return;
      }
      this.rawSend({ t: 'ping' });
    }, PING_EVERY_MS);
  }

  private reconnectNow = () => {
    if (this.closed) return;
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.retryDelay = 0;
    this.socket?.close();
    this.connect();
  };

  /** Reconnects to fetch a fresh copy of the board from the server. */
  resync() {
    this.socket?.close();
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible') this.reconnectNow();
  };

  private rawSend(message: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN || this.status !== 'live')
      return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  sendOperation(op: Operation) {
    this.outbox = [...this.outbox, op];
    writeOutbox(this.outboxKey, this.outbox);
    this.handlers.onPending(this.outbox.length);
    this.rawSend({ t: 'op', op });
  }

  sendChat(clientId: string, text: string) {
    return this.rawSend({ t: 'chat', clientId, text });
  }

  sendTyping() {
    this.rawSend({ t: 'typing' });
  }

  sendSignal(to: string, data: unknown) {
    this.rawSend({ t: 'signal', to, data });
  }

  setCall(inCall: boolean, muted: boolean) {
    this.call = { inCall, muted };
    this.rawSend({ t: 'call', inCall, muted });
  }

  // ---- Live activity, coalesced per frame ----

  liveCursor(cursor: LiveCursor | null) {
    this.live.cursor = cursor;
    this.scheduleLive();
  }

  /** Streams an object that is being drawn, moved, resized, or typed. */
  liveUpsert(objects: BoardObject[]) {
    const upsert = new Map(
      (this.live.upsert ?? []).map((object) => [object.id, object]),
    );
    for (const object of objects) {
      upsert.set(object.id, object);
      this.appendIndex.delete(object.id);
    }
    this.live.upsert = [...upsert.values()];
    this.live.append = this.live.append?.filter((item) => !upsert.has(item.id));
    this.scheduleLive();
  }

  /** Adds points to a pen stroke that was already sent with liveUpsert. */
  liveAppend(id: string, points: number[]) {
    if (this.live.upsert?.some((object) => object.id === id)) {
      this.live.upsert = this.live.upsert.map((object) =>
        object.id === id
          ? { ...object, points: [...(object.points ?? []), ...points] }
          : object,
      );
    } else {
      let pending = this.appendIndex.get(id);
      if (!pending) {
        pending = [];
        this.appendIndex.set(id, pending);
        this.live.append = [
          ...(this.live.append ?? []),
          { id, points: pending },
        ];
      }
      pending.push(...points);
    }
    this.scheduleLive();
  }

  liveRemove(ids: string[]) {
    if (!ids.length) return;
    const removed = new Set(ids);
    this.live.upsert = this.live.upsert?.filter(
      (object) => !removed.has(object.id),
    );
    this.live.append = this.live.append?.filter(
      (item) => !removed.has(item.id),
    );
    for (const id of ids) this.appendIndex.delete(id);
    this.live.remove = [...(this.live.remove ?? []), ...ids];
    this.scheduleLive();
  }

  /** Sends pending live activity now, before an operation that ends it. */
  flushLive() {
    clearTimeout(this.liveTimer);
    this.liveTimer = undefined;
    const live = this.live;
    this.live = {};
    this.appendIndex.clear();
    const message: Record<string, unknown> = { t: 'live' };
    if (live.cursor !== undefined) message.cursor = live.cursor;
    if (live.upsert?.length) message.upsert = live.upsert;
    if (live.append?.length) message.append = live.append;
    if (live.remove?.length) message.remove = live.remove;
    if (Object.keys(message).length > 1) this.rawSend(message);
  }

  private scheduleLive() {
    if (this.liveTimer) return;
    this.liveTimer = setTimeout(() => this.flushLive(), LIVE_FLUSH_MS);
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.liveTimer);
    clearInterval(this.pingTimer);
    window.removeEventListener('online', this.reconnectNow);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.socket?.close();
    this.socket = null;
  }
}
