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
};
export type ChatMessage = {
  id: string;
  userId: string;
  name: string;
  text: string;
  createdAt: string;
};
export type Peer = {
  userId: string;
  name: string;
  color: string;
  x?: number;
  y?: number;
};
export type Board = {
  id: string;
  title: string;
  ownerId: string;
  role: Role;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
  objects: BoardObject[];
  messages: ChatMessage[];
  members: { userId: string; role: Role; name: string; online?: boolean }[];
  inviteToken?: string;
  inviteRevoked?: boolean;
};
export type Session = { token: string; user: { id: string; name: string } };
export type PendingOperation = {
  id: string;
  type: 'create' | 'update' | 'delete';
  objectId: string;
  object?: BoardObject;
  fields?: Partial<BoardObject>;
};

const SESSION_KEY = 'collabboard.session';
const outboxKey = (boardId: string) => `canvasroom.outbox.${boardId}`;
const boardCacheKey = (boardId: string) => `canvasroom.board.${boardId}`;
export function readSession(): Session | null {
  try {
    return JSON.parse(
      localStorage.getItem(SESSION_KEY) ?? 'null',
    ) as Session | null;
  } catch {
    return null;
  }
}
export function writeSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
export function readOutbox(boardId: string): PendingOperation[] {
  try {
    return JSON.parse(
      localStorage.getItem(outboxKey(boardId)) ?? '[]',
    ) as PendingOperation[];
  } catch {
    return [];
  }
}
export function writeOutbox(boardId: string, operations: PendingOperation[]) {
  if (operations.length)
    localStorage.setItem(outboxKey(boardId), JSON.stringify(operations));
  else localStorage.removeItem(outboxKey(boardId));
}
export function readCachedBoard(boardId: string): Board | null {
  try {
    return JSON.parse(
      localStorage.getItem(boardCacheKey(boardId)) ?? 'null',
    ) as Board | null;
  } catch {
    return null;
  }
}
export function writeCachedBoard(board: Board) {
  try {
    localStorage.setItem(boardCacheKey(board.id), JSON.stringify(board));
  } catch {
    /* The server copy remains authoritative if browser storage is full. */
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

export async function api<T>(
  path: string,
  init: RequestInit = {},
  session = readSession(),
): Promise<T> {
  const headers = new Headers(init.headers);
  if (session) headers.set('Authorization', `Bearer ${session.token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...init, headers });
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
