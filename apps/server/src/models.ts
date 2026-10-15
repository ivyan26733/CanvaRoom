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
};

export type User = { id: string; name: string };

/** One connected tab. `peerId` is stable across reconnects so audio peers survive them. */
export type Presence = {
  peerId: string;
  userId: string;
  name: string;
  color: string;
  inCall: boolean;
  muted: boolean;
  updatedAt: number;
};
