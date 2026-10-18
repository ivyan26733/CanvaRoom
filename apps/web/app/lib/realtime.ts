import {
  readOutbox,
  writeOutbox,
  type Board,
  type BoardObject,
  type ChatMessage,
  type Operation,
  type Peer,
} from './api';

export type LiveCursor = {
  x: number;
  y: number;
  page?: string;
  /** Set while this person is drawing, erasing, or typing. */
  active?: boolean;
  /** The part of the canvas they see while active: x, y, width, height. */
  view?: [number, number, number, number];
};

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
      /** Calls go through the server's SFU rather than peer to peer. */
      sfu?: boolean;
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

/** A microphone on the SFU, with the server's proof that it is this tab's. */
export type CallAudio = { session: string; track: string; token: string };

export type ConnectionStatus = 'connecting' | 'live' | 'offline';

type Handlers = {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  /** Called when unsent edits change, so the UI can show a saving state. */
  onPending: (count: number) => void;
  /** True while someone is mid-gesture, so a planned reconnect waits. */
  isBusy?: () => boolean;
};

const PING_EVERY_MS = 10_000;
const DEAD_AFTER_MS = 25_000;
const LIVE_FLUSH_MS = 16;
/**
 * Vercel ends a WebSocket when its function reaches the maximum duration (300 s
 * on Hobby). Reconnecting a little earlier, at a moment when nobody is
 * mid-stroke, keeps that cut from interrupting anything.
 */
const ROTATE_AFTER_MS =
  Number(process.env.NEXT_PUBLIC_REALTIME_ROTATE_MS) || 265_000;
const ROTATE_DEADLINE_MS = ROTATE_AFTER_MS + 27_000;
/** Closing code that tells the server a replacement connection took over. */
const HANDED_OVER = 4001;
/** How long edits are kept to replay over a fresh board snapshot. */
const RECENT_OPS_MS = 10_000;
const RETRY_SAVE_MS = 2_000;
/** A tab hidden this long shows as away; quick tab switches don't flicker. */
const AWAY_AFTER_MS = 5_000;
/** Back from the background with nothing heard this long: the socket may be dead. */
const STALE_ON_RETURN_MS = 8_000;

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
  /** A replacement connection opened before the current one is closed. */
  private next: WebSocket | null = null;
  private outbox: Operation[];
  private recentOps: { at: number; op: Operation }[] = [];
  private closed = false;
  private retryDelay = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private rotateTimer: ReturnType<typeof setInterval> | undefined;
  private lastHeard = Date.now();
  private openedAt = 0;
  private call: { inCall: boolean; muted: boolean; audio?: CallAudio } = {
    inCall: false,
    muted: false,
  };
  private away = false;
  private awayTimer: ReturnType<typeof setTimeout> | undefined;
  /** The page is hidden in the back/forward cache, so stay disconnected. */
  private suspended = false;
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
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    document.addEventListener('visibilitychange', this.onVisible);
    if (document.visibilityState === 'hidden') this.onVisible();
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

  /**
   * Opens a connection. With `handover`, the current one keeps carrying
   * everything until the new one is live, so planned reconnects (Vercel's
   * duration limit, a resync) never drop anyone from the room or the call.
   */
  private connect(handover = false) {
    if (this.closed || this.suspended) return;
    clearTimeout(this.retryTimer);
    if (handover && this.socket?.readyState !== WebSocket.OPEN)
      handover = false;
    if (!handover)
      this.setStatus(this.status === 'live' ? 'connecting' : this.status);
    const socket = new WebSocket(realtimeUrl());
    if (handover) {
      this.next?.close();
      this.next = socket;
    } else {
      this.next?.close();
      this.next = null;
      const prior = this.socket;
      this.socket = socket;
      prior?.close();
    }
    let welcomed = false;
    socket.onopen = () => {
      if (!handover) this.lastHeard = Date.now();
      socket.send(
        JSON.stringify({
          t: 'hello',
          boardId: this.boardId,
          peerId: this.peerId,
          color: this.color,
          ...this.call,
          ...(this.away ? { away: true } : {}),
        }),
      );
    };
    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (message.t === 'welcome') {
        welcomed = true;
        if (this.next === socket) {
          const old = this.socket;
          this.next = null;
          this.socket = socket;
          old?.close(HANDED_OVER, 'handed over');
        }
        this.lastHeard = Date.now();
        this.retryDelay = 0;
        this.openedAt = Date.now();
        this.setStatus('live');
        this.handlers.onMessage(message);
        // Replay anything the server has not confirmed. Operations are
        // idempotent, so a replay of an applied edit is harmless.
        for (const op of this.outbox) this.rawSend({ t: 'op', op });
        this.startPing();
        return;
      }
      if (this.socket !== socket) {
        // Before its welcome, a replacement only matters once the old
        // connection is gone; until then both carry the same messages.
        if (this.next !== socket || welcomed) return;
        if (this.socket?.readyState === WebSocket.OPEN) return;
      }
      this.lastHeard = Date.now();
      if (message.t === 'op') this.remember(message.op);
      if (message.t === 'ack' || message.t === 'nack') {
        if (message.t === 'nack' && message.retry) {
          this.retrySoon(message.id);
          return;
        }
        const own = this.outbox.find((op) => op.id === message.id);
        if (own && message.t === 'ack') this.remember(own);
        this.outbox = this.outbox.filter((op) => op.id !== message.id);
        writeOutbox(this.outboxKey, this.outbox);
        this.handlers.onPending(this.outbox.length);
      }
      if (message.t === 'error' && message.fatal) this.closed = true;
      this.handlers.onMessage(message);
    };
    socket.onclose = () => {
      if (this.next === socket) {
        // The replacement failed; the current connection carries on, and the
        // next rotation tries again.
        this.next = null;
        if (this.socket?.readyState === WebSocket.OPEN) return;
        this.socket = null;
      } else if (this.socket !== socket) return;
      else if (this.next) {
        // The server dropped the old connection as the new one joined.
        this.socket = null;
        return;
      }
      this.socket = null;
      clearInterval(this.pingTimer);
      clearInterval(this.rotateTimer);
      if (this.closed || this.suspended) return;
      this.setStatus('offline');
      this.retryTimer = setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(8000, Math.max(500, this.retryDelay * 2));
    };
    socket.onerror = () => socket.close();
  }

  private remember(op: Operation) {
    const now = Date.now();
    this.recentOps = this.recentOps.filter(
      (item) => now - item.at < RECENT_OPS_MS,
    );
    this.recentOps.push({ at: now, op });
  }

  /**
   * Edits from the last few seconds, by anyone. A board snapshot can be read
   * just before an edit that was already delivered (or confirmed) is saved,
   * so these are replayed on top of it.
   */
  get recentOperations() {
    const now = Date.now();
    return this.recentOps
      .filter((item) => now - item.at < RECENT_OPS_MS)
      .map((item) => item.op);
  }

  /** Resends an edit the server could not save, without waiting to reconnect. */
  private retrySoon(id: string) {
    setTimeout(() => {
      const op = this.outbox.find((item) => item.id === id);
      if (op) this.rawSend({ t: 'op', op });
    }, RETRY_SAVE_MS);
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
    clearInterval(this.rotateTimer);
    this.rotateTimer = setInterval(() => {
      const age = Date.now() - this.openedAt;
      if (age < ROTATE_AFTER_MS) return;
      if (age < ROTATE_DEADLINE_MS && this.handlers.isBusy?.()) return;
      if (this.next) return;
      this.flushLive();
      this.retryDelay = 0;
      this.openedAt = Date.now();
      this.connect(true);
    }, 1_000);
  }

  private reconnectNow = () => {
    if (this.closed) return;
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.socket?.readyState === WebSocket.CONNECTING) return;
    this.retryDelay = 0;
    const stale = this.socket;
    this.socket = null;
    stale?.close();
    this.connect();
  };

  /** Fetches a fresh copy of the board without leaving the room. */
  resync() {
    if (this.next) return;
    this.connect(true);
  }

  private onVisible = () => {
    clearTimeout(this.awayTimer);
    if (document.visibilityState === 'hidden') {
      this.awayTimer = setTimeout(() => this.setAway(true), AWAY_AFTER_MS);
      return;
    }
    this.setAway(false);
    // A phone that slept may still report the old socket as open although
    // the server dropped it long ago.
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      Date.now() - this.lastHeard > STALE_ON_RETURN_MS
    ) {
      this.rawSend({ t: 'ping' });
      const before = this.lastHeard;
      setTimeout(() => {
        if (this.lastHeard === before && !this.closed) this.socket?.close();
      }, 2_000);
    }
    this.reconnectNow();
  };

  private setAway(away: boolean) {
    if (this.away === away) return;
    this.away = away;
    this.rawSend({ t: 'away', away });
  }

  /** Tells the room this tab is gone before the page unloads or freezes. */
  private onPageHide = (event: PageTransitionEvent) => {
    if (this.closed) return;
    this.flushLive();
    for (const socket of [this.socket, this.next])
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send('{"t":"bye"}');
        socket.close(1000, 'bye');
      }
    if (event.persisted) {
      // Kept in the back/forward cache: reconnect if the page comes back.
      this.suspended = true;
      clearInterval(this.pingTimer);
      clearInterval(this.rotateTimer);
      clearTimeout(this.retryTimer);
    }
  };

  private onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || !this.suspended) return;
    this.suspended = false;
    this.retryDelay = 0;
    this.socket = null;
    this.next = null;
    this.connect();
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

  /** `audio` names the microphone this tab published to the SFU. */
  setCall(inCall: boolean, muted: boolean, audio?: CallAudio) {
    this.call = { inCall, muted, ...(audio ? { audio } : {}) };
    this.rawSend({ t: 'call', ...this.call });
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
    clearInterval(this.rotateTimer);
    clearTimeout(this.awayTimer);
    window.removeEventListener('online', this.reconnectNow);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    document.removeEventListener('visibilitychange', this.onVisible);
    for (const socket of [this.socket, this.next])
      if (socket?.readyState === WebSocket.OPEN) socket.send('{"t":"bye"}');
    this.next?.close();
    this.next = null;
    this.socket?.close();
    this.socket = null;
  }
}
