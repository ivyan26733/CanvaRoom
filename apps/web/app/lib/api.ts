export type Role = 'owner' | 'editor' | 'viewer';
export type BoardObject = {
  id: string;
  kind:
    | 'path'
    | 'line'
    | 'rect'
    | 'ellipse'
    | 'diamond'
    | 'triangle'
    | 'right-triangle'
    | 'parallelogram'
    | 'trapezoid'
    | 'pentagon'
    | 'hexagon'
    | 'star'
    | 'cylinder'
    | 'bubble'
    | 'arrow'
    | 'text'
    | 'sticky'
    | 'image';
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number[];
  text?: string;
  src?: string;
  color: string;
  strokeWidth: number;
  rotation?: number;
  fontSize?: number;
  opacity?: number;
  fillColor?: string;
  /** Mirrored left-to-right (flipX) or top-to-bottom (flipY). */
  flipX?: boolean;
  flipY?: boolean;
  /** The page this object sits on. Missing or unknown pages mean the first page. */
  page?: string;
};
export type Page = { id: string; name: string };
export const DEFAULT_PAGES: Page[] = [{ id: 'p1', name: 'Page 1' }];
export type BoardListItem = {
  id: string;
  title: string;
  role: Role;
  locked: boolean;
  updatedAt: string;
  objectCount: number;
};
export type ChatMessage = {
  id: string;
  userId: string;
  name: string;
  text: string;
  createdAt: string;
  /** Set while a message this tab sent is still on its way to the server. */
  pending?: boolean;
};
/** One open tab in the room. */
export type Peer = {
  peerId: string;
  userId: string;
  name: string;
  color: string;
  inCall: boolean;
  muted: boolean;
  /** Their tab has been in the background for a while. */
  away?: boolean;
  /** They are recording this session. */
  recording?: boolean;
  /** Their microphone on the SFU, when calls go through one. */
  audio?: { session: string; track: string };
};
export type Board = {
  id: string;
  title: string;
  ownerId: string;
  role: Role;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  pages: Page[];
  members: { userId: string; role: Role; name: string }[];
  inviteToken?: string;
  inviteRevoked?: boolean;
  /**
   * What the owner's plan allows: its tier, when that tier ends (null on the
   * free plan), and whether this is the owner's first board, which the free
   * plan keeps editable. Missing on scratch boards, which have no plan.
   */
  plan?: { tier: Tier; until: string | null; firstBoard: boolean };
};
/** Premium while a paid month runs, then the trial while it lasts, then free. */
export type Tier = 'premium' | 'trial' | 'free';
/** The signed-in person: an account holder, or a guest who joined by invite. */
export type User = {
  id: string;
  name: string;
  color: string;
  guest: boolean;
  email?: string;
  role?: 'user' | 'admin';
  /**
   * Account holders only: active trial time used (the trial is 30 minutes of
   * use, counted only while the app is open in a visible tab) and when a paid
   * pass runs to.
   */
  plan?: { trialUsedSeconds: number; trialBeatAt?: string; paidUntil?: string };
  /** Account holders only: whether the email has been confirmed with a code. */
  emailVerified?: boolean;
  /** Whether a verification code can be emailed right now. */
  verifyAvailable?: boolean;
};
export type Operation = {
  id: string;
  type: 'create' | 'update' | 'delete';
  objectId: string;
  object?: BoardObject;
  fields?: Partial<BoardObject>;
};

const outboxKey = (boardId: string) => `collabboard.outbox.${boardId}`;

export function readOutbox(boardId: string): Operation[] {
  try {
    return JSON.parse(
      localStorage.getItem(outboxKey(boardId)) ?? '[]',
    ) as Operation[];
  } catch {
    return [];
  }
}
export function writeOutbox(boardId: string, operations: Operation[]) {
  try {
    if (operations.length)
      localStorage.setItem(outboxKey(boardId), JSON.stringify(operations));
    else localStorage.removeItem(outboxKey(boardId));
  } catch {
    /* Storage full or blocked: unsent edits stay in memory for this tab. */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Fired when the server says the trial is over; opens the upgrade dialog. */
export const PAYWALL_EVENT = 'canvaroom:paywall';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string')
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    if (payload.code === 'payment_required')
      window.dispatchEvent(
        new CustomEvent(PAYWALL_EVENT, { detail: payload.error ?? '' }),
      );
    throw new ApiError(
      payload.error ?? `Request failed (${response.status})`,
      response.status,
      payload.code,
    );
  }
  return payload;
}

export function send<T>(path: string, method: string, body?: unknown) {
  return api<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Stores an image for a board and returns the path objects refer to it by. */
export function uploadImage(boardId: string, image: Blob) {
  return api<{ src: string }>(`/boards/${encodeURIComponent(boardId)}/images`, {
    method: 'POST',
    body: image,
    headers: { 'Content-Type': image.type },
  });
}

export function id() {
  return crypto.randomUUID();
}

export function filename(title: string, extension: string) {
  const safeTitle =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'whiteboard';
  return `${safeTitle}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}
