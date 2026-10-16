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

/**
 * Where objects without a known page live: the board's original first page
 * while it exists, so reordering pages never moves older objects.
 */
export function homePage(pages: readonly Page[]) {
  return pages.some((page) => page.id === 'p1') ? 'p1' : pages[0]!.id;
}

/** The page an object is shown on, given the board's current pages. */
export function pageOf(object: { page?: string }, pages: readonly Page[]) {
  return object.page && pages.some((page) => page.id === object.page)
    ? object.page
    : homePage(pages);
}

export type Operation = {
  id: string;
  type: 'create' | 'update' | 'delete';
  objectId: string;
  object?: BoardObject;
  fields?: Partial<BoardObject>;
};

export type Member = { role: Role; name: string };

/** Board settings and membership. Objects, chat, and snapshots are stored separately. */
export type BoardMeta = {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  locked: boolean;
  inviteToken: string;
  inviteRevoked: boolean;
  members: Record<string, Member>;
  pages: Page[];
};

export type ChatMessage = {
  id: string;
  userId: string;
  name: string;
  text: string;
  createdAt: string;
};

export type Snapshot = {
  id: string;
  createdAt: string;
  title: string;
  objects: BoardObject[];
  pages?: Page[];
};

/** A signed-in person: an account holder, or a guest who joined by invite. */
export type User = {
  id: string;
  name: string;
  color: string;
  guest: boolean;
  email?: string;
};

export type Account = {
  id: string;
  email: string;
  name: string;
  color: string;
  createdAt: string;
  /** `scrypt$N$r$p$salt$hash`, never sent to clients. */
  passwordHash: string;
};

/** Server-side session, stored under a hash of the cookie token. */
export type SessionRecord = {
  userId: string;
  /** Present for guests, who have no account record. */
  guest?: { name: string; color: string };
};

/** One connected tab. `peerId` is stable across reconnects so audio peers survive them. */
export type Presence = {
  peerId: string;
  userId: string;
  name: string;
  color: string;
  inCall: boolean;
  muted: boolean;
  updatedAt: number;
  /** The server instance holding this tab's socket. */
  instance?: string;
};
