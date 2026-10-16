export type Role = 'owner' | 'editor' | 'viewer';
export type BoardObject = {
  id: string;
  kind:
    | 'path'
    | 'line'
    | 'rect'
    | 'ellipse'
    | 'diamond'
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
};
/** The signed-in person: an account holder, or a guest who joined by invite. */
export type User = {
  id: string;
  name: string;
  color: string;
  guest: boolean;
  email?: string;
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
  ) {
    super(message);
  }
}

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
  };
  if (!response.ok)
    throw new ApiError(
      payload.error ?? `Request failed (${response.status})`,
      response.status,
    );
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
