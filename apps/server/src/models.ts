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
  boardId: string;
  actorId: string;
  createdAt: string;
  type: 'create' | 'update' | 'delete';
  objectId: string;
  object?: BoardObject;
  fields?: Partial<BoardObject>;
  revision: number;
};

export type BoardRecord = {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  locked: boolean;
  members: Record<string, { role: Role; name: string }>;
  inviteToken: string;
  inviteRevoked: boolean;
  objects: Record<string, BoardObject>;
  deletedObjectIds: string[];
  operations: Operation[];
  seenOperationIds: string[];
  messages: ChatMessage[];
  snapshots: {
    id: string;
    createdAt: string;
    title: string;
    objects: BoardObject[];
  }[];
  revision: number;
};

export type ChatMessage = {
  id: string;
  userId: string;
  name: string;
  text: string;
  createdAt: string;
};
export type User = { id: string; name: string };
export type Presence = {
  userId: string;
  name: string;
  color: string;
  x?: number;
  y?: number;
  updatedAt: number;
};

export type PersistedState = { boards: Record<string, BoardRecord> };
