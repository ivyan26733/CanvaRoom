import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Redis } from 'ioredis';
import { config } from './config.js';
import type {
  BoardMeta,
  BoardObject,
  ChatMessage,
  Member,
  Operation,
  Presence,
  Snapshot,
} from './models.js';

export type BoardListItem = {
  id: string;
  title: string;
  role: Member['role'];
  locked: boolean;
  updatedAt: string;
  objectCount: number;
};

/**
 * Board persistence. Objects are stored individually so that two people
 * editing different objects never overwrite each other, and so that one edit
 * writes one object instead of the whole board.
 */
export interface Store {
  createBoard(meta: BoardMeta, objects: BoardObject[]): Promise<void>;
  getMeta(boardId: string): Promise<BoardMeta | undefined>;
  updateMeta(
    boardId: string,
    fields: Partial<
      Pick<
        BoardMeta,
        'title' | 'locked' | 'inviteToken' | 'inviteRevoked' | 'updatedAt'
      >
    >,
  ): Promise<void>;
  setMember(boardId: string, userId: string, member: Member): Promise<void>;
  deleteBoard(boardId: string): Promise<void>;
  listBoards(userId: string): Promise<BoardListItem[]>;
  getObjects(boardId: string): Promise<BoardObject[]>;
  /** Applies one operation atomically. Returns false when it changed nothing. */
  applyOperation(boardId: string, operation: Operation): Promise<boolean>;
  replaceObjects(boardId: string, objects: BoardObject[]): Promise<void>;
  addMessage(boardId: string, message: ChatMessage): Promise<void>;
  getMessages(boardId: string): Promise<ChatMessage[]>;
  addSnapshot(boardId: string, snapshot: Snapshot): Promise<void>;
  getSnapshots(boardId: string): Promise<Snapshot[]>;
  setPresence(boardId: string, presence: Presence): Promise<void>;
  removePresence(boardId: string, peerId: string): Promise<void>;
  listPresence(boardId: string): Promise<Presence[]>;
}

const MAX_MESSAGES = 500;
const MAX_SNAPSHOTS = 50;
export const PRESENCE_TTL_MS = 45_000;

const keys = {
  meta: (id: string) => `b:${id}`,
  members: (id: string) => `b:${id}:members`,
  objects: (id: string) => `b:${id}:objects`,
  tombstones: (id: string) => `b:${id}:tomb`,
  messages: (id: string) => `b:${id}:messages`,
  snapshots: (id: string) => `b:${id}:snapshots`,
  presence: (id: string) => `b:${id}:presence`,
  userBoards: (userId: string) => `u:${userId}:boards`,
};

// One round trip, atomic per board: tombstoned objects are never recreated,
// and updates merge fields into the stored object.
const applyOperationScript = `
local kind = ARGV[1]
local id = ARGV[2]
if kind == 'delete' then
  redis.call('SADD', KEYS[2], id)
  local removed = redis.call('HDEL', KEYS[1], id)
  redis.call('HSET', KEYS[3], 'updatedAt', ARGV[4])
  return removed
end
if redis.call('SISMEMBER', KEYS[2], id) == 1 then return 0 end
if kind == 'create' then
  local created = redis.call('HSETNX', KEYS[1], id, ARGV[3])
  redis.call('HSET', KEYS[3], 'updatedAt', ARGV[4])
  return created
end
local current = redis.call('HGET', KEYS[1], id)
if not current then return 0 end
local object = cjson.decode(current)
for field, value in pairs(cjson.decode(ARGV[3])) do object[field] = value end
redis.call('HSET', KEYS[1], id, cjson.encode(object))
redis.call('HSET', KEYS[3], 'updatedAt', ARGV[4])
return 1
`;

function metaToHash(meta: Partial<BoardMeta>) {
  const hash: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'members' || key === 'id' || value === undefined) continue;
    hash[key] =
      typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  }
  return hash;
}

function hashToMeta(
  id: string,
  hash: Record<string, string>,
  members: Record<string, string>,
): BoardMeta | undefined {
  if (!hash.ownerId) return;
  return {
    id,
    title: hash.title ?? 'Untitled board',
    ownerId: hash.ownerId,
    createdAt: hash.createdAt ?? new Date(0).toISOString(),
    updatedAt: hash.updatedAt ?? new Date(0).toISOString(),
    locked: hash.locked === '1',
    inviteToken: hash.inviteToken ?? '',
    inviteRevoked: hash.inviteRevoked === '1',
    members: Object.fromEntries(
      Object.entries(members).map(([userId, value]) => [
        userId,
        JSON.parse(value) as Member,
      ]),
    ),
  };
}

function parseAll<T>(values: (string | null)[]) {
  return values.flatMap((value) => (value ? [JSON.parse(value) as T] : []));
}

export class RedisStore implements Store {
  constructor(private readonly redis: Redis) {}

  async createBoard(meta: BoardMeta, objects: BoardObject[]) {
    const multi = this.redis.multi();
    multi.hset(keys.meta(meta.id), metaToHash(meta));
    for (const [userId, member] of Object.entries(meta.members)) {
      multi.hset(keys.members(meta.id), userId, JSON.stringify(member));
      multi.sadd(keys.userBoards(userId), meta.id);
    }
    if (objects.length)
      multi.hset(
        keys.objects(meta.id),
        Object.fromEntries(
          objects.map((object) => [object.id, JSON.stringify(object)]),
        ),
      );
    await multi.exec();
  }

  async getMeta(boardId: string) {
    const [meta, members] = await Promise.all([
      this.redis.hgetall(keys.meta(boardId)),
      this.redis.hgetall(keys.members(boardId)),
    ]);
    return hashToMeta(boardId, meta, members);
  }

  async updateMeta(boardId: string, fields: Partial<BoardMeta>) {
    await this.redis.hset(keys.meta(boardId), metaToHash(fields));
  }

  async setMember(boardId: string, userId: string, member: Member) {
    await this.redis
      .multi()
      .hset(keys.members(boardId), userId, JSON.stringify(member))
      .sadd(keys.userBoards(userId), boardId)
      .exec();
  }

  async deleteBoard(boardId: string) {
    const members = await this.redis.hkeys(keys.members(boardId));
    const multi = this.redis.multi();
    for (const userId of members) multi.srem(keys.userBoards(userId), boardId);
    multi.del(
      keys.meta(boardId),
      keys.members(boardId),
      keys.objects(boardId),
      keys.tombstones(boardId),
      keys.messages(boardId),
      keys.snapshots(boardId),
      keys.presence(boardId),
    );
    await multi.exec();
  }

  async listBoards(userId: string) {
    const boardIds = await this.redis.smembers(keys.userBoards(userId));
    if (!boardIds.length) return [];
    const pipeline = this.redis.pipeline();
    for (const boardId of boardIds) {
      pipeline.hgetall(keys.meta(boardId));
      pipeline.hget(keys.members(boardId), userId);
      pipeline.hlen(keys.objects(boardId));
    }
    const results = (await pipeline.exec()) ?? [];
    const boards: BoardListItem[] = [];
    boardIds.forEach((boardId, index) => {
      const meta = results[index * 3]?.[1] as Record<string, string>;
      const member = results[index * 3 + 1]?.[1] as string | null;
      const count = results[index * 3 + 2]?.[1] as number;
      if (!meta?.ownerId || !member) return;
      boards.push({
        id: boardId,
        title: meta.title ?? 'Untitled board',
        role: (JSON.parse(member) as Member).role,
        locked: meta.locked === '1',
        updatedAt: meta.updatedAt ?? '',
        objectCount: count ?? 0,
      });
    });
    return boards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getObjects(boardId: string) {
    return parseAll<BoardObject>(
      Object.values(await this.redis.hgetall(keys.objects(boardId))),
    );
  }

  async applyOperation(boardId: string, operation: Operation) {
    const payload =
      operation.type === 'create'
        ? JSON.stringify(operation.object)
        : operation.type === 'update'
          ? JSON.stringify(operation.fields)
          : '';
    const changed = await this.redis.eval(
      applyOperationScript,
      3,
      keys.objects(boardId),
      keys.tombstones(boardId),
      keys.meta(boardId),
      operation.type,
      operation.objectId,
      payload,
      new Date().toISOString(),
    );
    return changed === 1;
  }

  async replaceObjects(boardId: string, objects: BoardObject[]) {
    const current = await this.redis.hkeys(keys.objects(boardId));
    const multi = this.redis.multi();
    if (current.length) multi.sadd(keys.tombstones(boardId), ...current);
    multi.del(keys.objects(boardId));
    if (objects.length)
      multi.hset(
        keys.objects(boardId),
        Object.fromEntries(
          objects.map((object) => [object.id, JSON.stringify(object)]),
        ),
      );
    multi.hset(keys.meta(boardId), 'updatedAt', new Date().toISOString());
    await multi.exec();
  }

  async addMessage(boardId: string, message: ChatMessage) {
    await this.redis
      .multi()
      .rpush(keys.messages(boardId), JSON.stringify(message))
      .ltrim(keys.messages(boardId), -MAX_MESSAGES, -1)
      .exec();
  }

  async getMessages(boardId: string) {
    return parseAll<ChatMessage>(
      await this.redis.lrange(keys.messages(boardId), 0, -1),
    );
  }

  async addSnapshot(boardId: string, snapshot: Snapshot) {
    await this.redis
      .multi()
      .rpush(keys.snapshots(boardId), JSON.stringify(snapshot))
      .ltrim(keys.snapshots(boardId), -MAX_SNAPSHOTS, -1)
      .exec();
  }

  async getSnapshots(boardId: string) {
    return parseAll<Snapshot>(
      await this.redis.lrange(keys.snapshots(boardId), 0, -1),
    );
  }

  async setPresence(boardId: string, presence: Presence) {
    await this.redis.hset(
      keys.presence(boardId),
      presence.peerId,
      JSON.stringify(presence),
    );
  }

  async removePresence(boardId: string, peerId: string) {
    await this.redis.hdel(keys.presence(boardId), peerId);
  }

  async listPresence(boardId: string) {
    const entries = await this.redis.hgetall(keys.presence(boardId));
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    const live: Presence[] = [];
    const stale: string[] = [];
    for (const [peerId, value] of Object.entries(entries)) {
      const presence = JSON.parse(value) as Presence;
      if (presence.updatedAt < cutoff) stale.push(peerId);
      else live.push(presence);
    }
    if (stale.length) await this.redis.hdel(keys.presence(boardId), ...stale);
    return live;
  }
}

type MemoryBoard = {
  meta: BoardMeta;
  objects: Map<string, BoardObject>;
  tombstones: Set<string>;
  messages: ChatMessage[];
  snapshots: Snapshot[];
};

/** Single-process store for local development, optionally saved to a JSON file. */
class MemoryStore implements Store {
  private boards = new Map<string, MemoryBoard>();
  private presence = new Map<string, Map<string, Presence>>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly file?: string) {}

  async load() {
    if (!this.file) return;
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as {
        version?: number;
        boards?: Record<string, unknown>;
      };
      // Older prototype files use a different shape; start fresh rather than misread them.
      if (saved.version !== 2 || !saved.boards) return;
      for (const [id, value] of Object.entries(saved.boards)) {
        const board = value as Omit<MemoryBoard, 'objects' | 'tombstones'> & {
          objects: BoardObject[];
          tombstones: string[];
        };
        this.boards.set(id, {
          ...board,
          objects: new Map(board.objects.map((object) => [object.id, object])),
          tombstones: new Set(board.tombstones),
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save();
    }, 250);
  }

  private async save() {
    if (!this.file) return;
    const boards = Object.fromEntries(
      [...this.boards].map(([id, board]) => [
        id,
        {
          ...board,
          objects: [...board.objects.values()],
          tombstones: [...board.tombstones],
        },
      ]),
    );
    const temp = `${this.file}.tmp`;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(temp, JSON.stringify({ version: 2, boards }), 'utf8');
    await rename(temp, this.file);
  }

  private touch(board: MemoryBoard) {
    board.meta.updatedAt = new Date().toISOString();
    this.scheduleSave();
  }

  async createBoard(meta: BoardMeta, objects: BoardObject[]) {
    this.boards.set(meta.id, {
      meta: structuredClone(meta),
      objects: new Map(objects.map((object) => [object.id, object])),
      tombstones: new Set(),
      messages: [],
      snapshots: [],
    });
    this.scheduleSave();
  }

  async getMeta(boardId: string) {
    const board = this.boards.get(boardId);
    return board ? structuredClone(board.meta) : undefined;
  }

  async updateMeta(boardId: string, fields: Partial<BoardMeta>) {
    const board = this.boards.get(boardId);
    if (!board) return;
    Object.assign(board.meta, fields);
    this.scheduleSave();
  }

  async setMember(boardId: string, userId: string, member: Member) {
    const board = this.boards.get(boardId);
    if (!board) return;
    board.meta.members[userId] = member;
    this.scheduleSave();
  }

  async deleteBoard(boardId: string) {
    this.boards.delete(boardId);
    this.presence.delete(boardId);
    this.scheduleSave();
  }

  async listBoards(userId: string) {
    return [...this.boards.values()]
      .filter((board) => board.meta.members[userId])
      .map((board) => ({
        id: board.meta.id,
        title: board.meta.title,
        role: board.meta.members[userId]!.role,
        locked: board.meta.locked,
        updatedAt: board.meta.updatedAt,
        objectCount: board.objects.size,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getObjects(boardId: string) {
    return [...(this.boards.get(boardId)?.objects.values() ?? [])];
  }

  async applyOperation(boardId: string, operation: Operation) {
    const board = this.boards.get(boardId);
    if (!board) return false;
    const { objectId } = operation;
    if (operation.type === 'delete') {
      board.tombstones.add(objectId);
      const removed = board.objects.delete(objectId);
      this.touch(board);
      return removed;
    }
    if (board.tombstones.has(objectId)) return false;
    if (operation.type === 'create') {
      if (board.objects.has(objectId) || !operation.object) return false;
      board.objects.set(objectId, operation.object);
    } else {
      const current = board.objects.get(objectId);
      if (!current) return false;
      board.objects.set(objectId, { ...current, ...operation.fields });
    }
    this.touch(board);
    return true;
  }

  async replaceObjects(boardId: string, objects: BoardObject[]) {
    const board = this.boards.get(boardId);
    if (!board) return;
    for (const id of board.objects.keys()) board.tombstones.add(id);
    board.objects = new Map(objects.map((object) => [object.id, object]));
    this.touch(board);
  }

  async addMessage(boardId: string, message: ChatMessage) {
    const board = this.boards.get(boardId);
    if (!board) return;
    board.messages.push(message);
    if (board.messages.length > MAX_MESSAGES) board.messages.shift();
    this.scheduleSave();
  }

  async getMessages(boardId: string) {
    return [...(this.boards.get(boardId)?.messages ?? [])];
  }

  async addSnapshot(boardId: string, snapshot: Snapshot) {
    const board = this.boards.get(boardId);
    if (!board) return;
    board.snapshots.push(snapshot);
    if (board.snapshots.length > MAX_SNAPSHOTS) board.snapshots.shift();
    this.scheduleSave();
  }

  async getSnapshots(boardId: string) {
    return [...(this.boards.get(boardId)?.snapshots ?? [])];
  }

  async setPresence(boardId: string, presence: Presence) {
    let room = this.presence.get(boardId);
    if (!room) this.presence.set(boardId, (room = new Map()));
    room.set(presence.peerId, presence);
  }

  async removePresence(boardId: string, peerId: string) {
    this.presence.get(boardId)?.delete(peerId);
  }

  async listPresence(boardId: string) {
    const room = this.presence.get(boardId);
    if (!room) return [];
    const cutoff = Date.now() - PRESENCE_TTL_MS;
    for (const [peerId, presence] of room)
      if (presence.updatedAt < cutoff) room.delete(peerId);
    return [...room.values()];
  }
}

export function createRedis() {
  if (!config.redisUrl) return;
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
  });
}

export const redis = createRedis();
export const store: Store = redis
  ? new RedisStore(redis)
  : new MemoryStore(
      process.env.VERCEL
        ? undefined
        : resolve(process.cwd(), 'data/state.json'),
    );

export async function loadStore() {
  if (store instanceof MemoryStore) await store.load();
}
