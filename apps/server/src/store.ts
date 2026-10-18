import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Redis } from 'ioredis';
import { config } from './config.js';
import { createPool } from './db.js';
import {
  DEFAULT_PAGES,
  MAX_MESSAGES,
  MAX_SNAPSHOTS,
  accruedTrial,
  planOf,
} from './models.js';
import { PostgresStore } from './pg-store.js';
import type {
  Account,
  BoardMeta,
  BoardObject,
  ChatMessage,
  Member,
  Operation,
  Page,
  Feedback,
  Payment,
  Plan,
  Presence,
  SessionRecord,
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
        | 'title'
        | 'locked'
        | 'inviteToken'
        | 'inviteRevoked'
        | 'updatedAt'
        | 'pages'
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
  /** The history list without each snapshot's objects, where supported. */
  listSnapshots?(
    boardId: string,
  ): Promise<Pick<Snapshot, 'id' | 'title' | 'createdAt'>[]>;
  setPresence(boardId: string, presence: Presence): Promise<void>;
  removePresence(boardId: string, peerId: string): Promise<void>;
  listPresence(boardId: string): Promise<Presence[]>;
  /** Returns false when the email is already registered. */
  createAccount(account: Account): Promise<boolean>;
  getAccount(userId: string): Promise<Account | undefined>;
  findAccountByEmail(email: string): Promise<Account | undefined>;
  updateAccount(
    userId: string,
    fields: Partial<Pick<Account, 'name' | 'color' | 'passwordHash'>>,
  ): Promise<void>;
  /** Board IDs the user belongs to, for renaming them across boards. */
  boardIdsFor(userId: string): Promise<string[]>;
  createSession(
    key: string,
    record: SessionRecord,
    ttlSeconds: number,
  ): Promise<void>;
  getSession(key: string): Promise<SessionRecord | undefined>;
  /**
   * A session with its account in one round trip, where the backend can do
   * that. Guests have no account.
   */
  getSessionAccount?(
    key: string,
  ): Promise<{ session: SessionRecord; account?: Account } | undefined>;
  deleteSession(key: string): Promise<void>;
  /** Ends every session of a user except `keep`. */
  deleteSessionsFor(userId: string, keep?: string): Promise<void>;
  /** Counts an attempt in a fixed window and returns the count so far. */
  hit(key: string, windowSeconds: number): Promise<number>;
  /** Stores a password-reset token, replacing any earlier one for the user. */
  createResetToken(key: string, userId: string, ttl: number): Promise<void>;
  /** Returns the user a reset token belongs to and uses it up. */
  takeResetToken(key: string): Promise<string | undefined>;
  createVerificationToken(
    key: string,
    userId: string,
    ttl: number,
  ): Promise<void>;
  verifyEmailToken(key: string): Promise<string | undefined>;
  completePasswordReset(
    key: string,
    passwordHash: string,
  ): Promise<string | undefined>;
  addFeedback(feedback: Feedback): Promise<void>;
  markFeedbackMailed(id: string): Promise<void>;
  createPayment(payment: Payment): Promise<void>;
  getPayment(orderId: string): Promise<Payment | undefined>;
  /**
   * Counts a moment of active use towards the account's free trial: the time
   * since the last count, unless the gap shows the person wasn't active.
   * Returns the account's plan after counting.
   */
  accrueTrial(userId: string): Promise<Plan | undefined>;
  /**
   * Marks an unpaid order paid and extends its user's pass by `days` from
   * the later of now and their current pass end. Returns the new pass end, or
   * undefined when the order was already paid.
   */
  completePayment(
    orderId: string,
    paymentId: string,
    days: number,
  ): Promise<string | undefined>;
}

/** The oldest of an owner's boards, given each board's owner and creation. */
const firstBoardOf = (
  ownerId: string,
  boards: (Pick<BoardMeta, 'id' | 'ownerId' | 'createdAt'> | undefined)[],
) =>
  boards
    .filter((board) => board?.ownerId === ownerId)
    .sort(
      (a, b) =>
        a!.createdAt.localeCompare(b!.createdAt) || a!.id.localeCompare(b!.id),
    )[0]?.id;

/** The later of `from` (or now, if sooner) and now, plus `days`. */
const extendPass = (from: string | undefined, days: number) =>
  new Date(
    Math.max(from ? new Date(from).getTime() : 0, Date.now()) +
      days * 86_400_000,
  ).toISOString();

/** Short-lived state that never needs to reach the database. */
export type LiveStore = Pick<
  Store,
  'setPresence' | 'removePresence' | 'listPresence' | 'hit'
>;

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
  account: (userId: string) => `acct:${userId}`,
  email: (email: string) => `email:${email}`,
  session: (key: string) => `sess:${key}`,
  userSessions: (userId: string) => `u:${userId}:sessions`,
  rate: (key: string) => `rl:${key}`,
  reset: (key: string) => `reset:${key}`,
  userReset: (userId: string) => `u:${userId}:reset`,
  verify: (key: string) => `verify:${key}`,
  userVerify: (userId: string) => `u:${userId}:verify`,
  payment: (orderId: string) => `pay:${orderId}`,
  feedback: 'feedback',
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
    // Owner access is read from the owner's account, never stored here.
    if (
      key === 'members' ||
      key === 'id' ||
      key === 'ownerPlan' ||
      key === 'ownerFirstBoard' ||
      value === undefined
    )
      continue;
    hash[key] =
      typeof value === 'boolean'
        ? value
          ? '1'
          : '0'
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
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
    pages: hash.pages ? (JSON.parse(hash.pages) as Page[]) : DEFAULT_PAGES,
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
    const board = hashToMeta(boardId, meta, members);
    if (!board) return;
    const [owner, ownedIds] = await Promise.all([
      this.getAccount(board.ownerId),
      this.redis.smembers(keys.userBoards(board.ownerId)),
    ]);
    const owned = await Promise.all(
      ownedIds.map(async (id) => {
        const [ownerId, createdAt] = await this.redis.hmget(
          keys.meta(id),
          'ownerId',
          'createdAt',
        );
        return ownerId && createdAt ? { id, ownerId, createdAt } : undefined;
      }),
    );
    return {
      ...board,
      ...(owner ? { ownerPlan: planOf(owner) } : {}),
      ownerFirstBoard: firstBoardOf(board.ownerId, owned) === board.id,
    };
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

  async createAccount(account: Account) {
    const claimed = await this.redis.set(
      keys.email(account.email),
      account.id,
      'NX',
    );
    if (claimed !== 'OK') return false;
    await this.redis.set(keys.account(account.id), JSON.stringify(account));
    return true;
  }

  async getAccount(userId: string) {
    const value = await this.redis.get(keys.account(userId));
    return value ? (JSON.parse(value) as Account) : undefined;
  }

  async findAccountByEmail(email: string) {
    const userId = await this.redis.get(keys.email(email));
    return userId ? this.getAccount(userId) : undefined;
  }

  async updateAccount(userId: string, fields: Partial<Account>) {
    const account = await this.getAccount(userId);
    if (!account) return;
    await this.redis.set(
      keys.account(userId),
      JSON.stringify({ ...account, ...fields }),
    );
  }

  async boardIdsFor(userId: string) {
    return this.redis.smembers(keys.userBoards(userId));
  }

  async createSession(key: string, record: SessionRecord, ttl: number) {
    await this.redis
      .multi()
      .set(keys.session(key), JSON.stringify(record), 'EX', ttl)
      .sadd(keys.userSessions(record.userId), key)
      .expire(keys.userSessions(record.userId), ttl)
      .exec();
  }

  async getSession(key: string) {
    const value = await this.redis.get(keys.session(key));
    return value ? (JSON.parse(value) as SessionRecord) : undefined;
  }

  async deleteSession(key: string) {
    const record = await this.getSession(key);
    const multi = this.redis.multi().del(keys.session(key));
    if (record) multi.srem(keys.userSessions(record.userId), key);
    await multi.exec();
  }

  async deleteSessionsFor(userId: string, keep?: string) {
    const sessions = await this.redis.smembers(keys.userSessions(userId));
    const ended = sessions.filter((key) => key !== keep);
    if (!ended.length) return;
    await this.redis
      .multi()
      .del(...ended.map(keys.session))
      .srem(keys.userSessions(userId), ...ended)
      .exec();
  }

  async createResetToken(key: string, userId: string, ttl: number) {
    const previous = await this.redis.get(keys.userReset(userId));
    const multi = this.redis.multi();
    if (previous) multi.del(keys.reset(previous));
    await multi
      .set(keys.reset(key), userId, 'EX', ttl)
      .set(keys.userReset(userId), key, 'EX', ttl)
      .exec();
  }

  async takeResetToken(key: string) {
    const userId = await this.redis.getdel(keys.reset(key));
    if (!userId) return;
    // Only the most recently requested link works.
    const current = await this.redis.getdel(keys.userReset(userId));
    return current === key ? userId : undefined;
  }

  async createVerificationToken(key: string, userId: string, ttl: number) {
    const previous = await this.redis.get(keys.userVerify(userId));
    const multi = this.redis.multi();
    if (previous) multi.del(keys.verify(previous));
    await multi
      .set(keys.verify(key), userId, 'EX', ttl)
      .set(keys.userVerify(userId), key, 'EX', ttl)
      .exec();
  }

  async verifyEmailToken(key: string) {
    const script = `
      local userId = redis.call('GET', KEYS[1])
      if not userId then return nil end
      local userVerifyKey = KEYS[2] .. userId .. ':verify'
      if redis.call('GET', userVerifyKey) ~= ARGV[1] then return nil end
      local accountKey = KEYS[3] .. userId
      local account = redis.call('GET', accountKey)
      if not account then return nil end
      local decoded = cjson.decode(account)
      decoded.emailVerified = true
      redis.call('SET', accountKey, cjson.encode(decoded))
      redis.call('DEL', KEYS[1], userVerifyKey)
      return userId
    `;
    return (await this.redis.eval(
      script,
      3,
      keys.verify(key),
      'u:',
      'acct:',
    )) as string | undefined;
  }

  async completePasswordReset(key: string, passwordHash: string) {
    const script = `
      local userId = redis.call('GET', KEYS[1])
      if not userId then return nil end
      local userResetKey = 'u:' .. userId .. ':reset'
      if redis.call('GET', userResetKey) ~= ARGV[1] then return nil end
      local accountKey = 'acct:' .. userId
      local account = redis.call('GET', accountKey)
      if not account then return nil end
      local decoded = cjson.decode(account)
      decoded.passwordHash = ARGV[2]
      redis.call('SET', accountKey, cjson.encode(decoded))
      local sessionsKey = 'u:' .. userId .. ':sessions'
      local sessions = redis.call('SMEMBERS', sessionsKey)
      for _, session in ipairs(sessions) do redis.call('DEL', 'sess:' .. session) end
      redis.call('DEL', sessionsKey, KEYS[1], userResetKey)
      return userId
    `;
    return (await this.redis.eval(
      script,
      1,
      keys.reset(key),
      key,
      passwordHash,
    )) as string | undefined;
  }

  async hit(key: string, windowSeconds: number) {
    const [[, count] = []] =
      (await this.redis
        .multi()
        .incr(keys.rate(key))
        .expire(keys.rate(key), windowSeconds, 'NX')
        .exec()) ?? [];
    return Number(count ?? 0);
  }

  async addFeedback(feedback: Feedback) {
    await this.redis.lpush(keys.feedback, JSON.stringify(feedback));
  }

  async markFeedbackMailed() {
    // Only Postgres records whether feedback was mailed.
  }

  async createPayment(payment: Payment) {
    await this.redis.set(
      keys.payment(payment.orderId),
      JSON.stringify(payment),
    );
  }

  async getPayment(orderId: string) {
    const value = await this.redis.get(keys.payment(orderId));
    return value ? (JSON.parse(value) as Payment) : undefined;
  }

  async accrueTrial(userId: string) {
    // Only used without Postgres (local development), so not atomic.
    const account = await this.getAccount(userId);
    if (!account) return;
    const trial = accruedTrial(account);
    if (!trial) return planOf(account);
    const next = { ...account, ...trial };
    await this.redis.set(keys.account(userId), JSON.stringify(next));
    return planOf(next);
  }

  async completePayment(orderId: string, paymentId: string, days: number) {
    // Only used without Postgres (local development), so not atomic.
    const payment = await this.getPayment(orderId);
    const account = payment && (await this.getAccount(payment.userId));
    if (!payment || payment.status === 'paid' || !account) return;
    const paidUntil = extendPass(account.paidUntil, days);
    await this.createPayment({
      ...payment,
      status: 'paid',
      paymentId,
      paidAt: new Date().toISOString(),
    });
    await this.redis.set(
      keys.account(account.id),
      JSON.stringify({ ...account, paidUntil }),
    );
    return paidUntil;
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
export class MemoryStore implements Store {
  private boards = new Map<string, MemoryBoard>();
  private presence = new Map<string, Map<string, Presence>>();
  private accounts = new Map<string, Account>();
  private sessions = new Map<string, SessionRecord & { expiresAt: number }>();
  private hits = new Map<string, { count: number; resetAt: number }>();
  private resets = new Map<string, { userId: string; expiresAt: number }>();
  private verifications = new Map<
    string,
    { userId: string; expiresAt: number }
  >();
  private payments = new Map<string, Payment>();
  private feedback: Feedback[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly file?: string) {}

  async load() {
    if (!this.file) return;
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as {
        version?: number;
        boards?: Record<string, unknown>;
        accounts?: Account[];
        sessions?: [string, SessionRecord & { expiresAt: number }][];
      };
      // Older prototype files use a different shape; start fresh rather than misread them.
      if (saved.version !== 2 || !saved.boards) return;
      for (const account of saved.accounts ?? [])
        this.accounts.set(account.id, account);
      this.sessions = new Map(saved.sessions ?? []);
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
    await writeFile(
      temp,
      JSON.stringify({
        version: 2,
        boards,
        accounts: [...this.accounts.values()],
        sessions: [...this.sessions],
      }),
      'utf8',
    );
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
    if (!board) return;
    // Files saved before pages existed have none.
    const meta = structuredClone(board.meta);
    meta.pages ??= DEFAULT_PAGES;
    const owner = this.accounts.get(meta.ownerId);
    if (owner) meta.ownerPlan = planOf(owner);
    else delete meta.ownerPlan;
    meta.ownerFirstBoard =
      firstBoardOf(
        meta.ownerId,
        [...this.boards.values()].map((item) => item.meta),
      ) === boardId;
    return meta;
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

  async createAccount(account: Account) {
    if (
      [...this.accounts.values()].some((item) => item.email === account.email)
    )
      return false;
    this.accounts.set(account.id, account);
    this.scheduleSave();
    return true;
  }

  async getAccount(userId: string) {
    return this.accounts.get(userId);
  }

  async findAccountByEmail(email: string) {
    return [...this.accounts.values()].find((item) => item.email === email);
  }

  async updateAccount(userId: string, fields: Partial<Account>) {
    const account = this.accounts.get(userId);
    if (!account) return;
    this.accounts.set(userId, { ...account, ...fields });
    this.scheduleSave();
  }

  async boardIdsFor(userId: string) {
    return [...this.boards.values()]
      .filter((board) => board.meta.members[userId])
      .map((board) => board.meta.id);
  }

  async createSession(key: string, record: SessionRecord, ttl: number) {
    this.sessions.set(key, { ...record, expiresAt: Date.now() + ttl * 1000 });
    this.scheduleSave();
  }

  async getSession(key: string) {
    const session = this.sessions.get(key);
    if (!session || session.expiresAt < Date.now()) return;
    return {
      userId: session.userId,
      ...(session.guest ? { guest: session.guest } : {}),
    };
  }

  async deleteSession(key: string) {
    this.sessions.delete(key);
    this.scheduleSave();
  }

  async deleteSessionsFor(userId: string, keep?: string) {
    for (const [key, session] of this.sessions)
      if (session.userId === userId && key !== keep) this.sessions.delete(key);
    this.scheduleSave();
  }

  async createResetToken(key: string, userId: string, ttl: number) {
    for (const [token, reset] of this.resets)
      if (reset.userId === userId) this.resets.delete(token);
    this.resets.set(key, { userId, expiresAt: Date.now() + ttl * 1000 });
  }

  async takeResetToken(key: string) {
    const reset = this.resets.get(key);
    this.resets.delete(key);
    return reset && reset.expiresAt > Date.now() ? reset.userId : undefined;
  }

  async createVerificationToken(key: string, userId: string, ttl: number) {
    for (const [token, verification] of this.verifications)
      if (verification.userId === userId) this.verifications.delete(token);
    this.verifications.set(key, { userId, expiresAt: Date.now() + ttl * 1000 });
  }

  async verifyEmailToken(key: string) {
    const verification = this.verifications.get(key);
    this.verifications.delete(key);
    if (!verification || verification.expiresAt <= Date.now()) return;
    const account = this.accounts.get(verification.userId);
    if (!account) return;
    this.accounts.set(verification.userId, { ...account, emailVerified: true });
    this.scheduleSave();
    return verification.userId;
  }

  async completePasswordReset(key: string, passwordHash: string) {
    const userId = await this.takeResetToken(key);
    if (!userId) return;
    await this.updateAccount(userId, { passwordHash });
    await this.deleteSessionsFor(userId);
    return userId;
  }

  async hit(key: string, windowSeconds: number) {
    const now = Date.now();
    const current = this.hits.get(key);
    const next =
      current && current.resetAt > now
        ? { ...current, count: current.count + 1 }
        : { count: 1, resetAt: now + windowSeconds * 1000 };
    this.hits.set(key, next);
    return next.count;
  }

  async addFeedback(feedback: Feedback) {
    this.feedback.push(feedback);
  }

  async markFeedbackMailed() {
    // Kept in memory only; nothing to update.
  }

  async createPayment(payment: Payment) {
    this.payments.set(payment.orderId, payment);
  }

  async getPayment(orderId: string) {
    return this.payments.get(orderId);
  }

  async accrueTrial(userId: string) {
    const account = this.accounts.get(userId);
    if (!account) return;
    const trial = accruedTrial(account);
    if (!trial) return planOf(account);
    const next = { ...account, ...trial };
    this.accounts.set(userId, next);
    this.scheduleSave();
    return planOf(next);
  }

  async completePayment(orderId: string, paymentId: string, days: number) {
    const payment = this.payments.get(orderId);
    const account = payment && this.accounts.get(payment.userId);
    if (!payment || payment.status === 'paid' || !account) return;
    const paidUntil = extendPass(account.paidUntil, days);
    this.payments.set(orderId, {
      ...payment,
      status: 'paid',
      paymentId,
      paidAt: new Date().toISOString(),
    });
    this.accounts.set(account.id, { ...account, paidUntil });
    this.scheduleSave();
    return paidUntil;
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

function createStore(): Store {
  if (config.databaseUrl)
    return new PostgresStore(
      createPool(config.databaseUrl),
      // Without Redis there is a single process, so memory is enough.
      redis ? new RedisStore(redis) : new MemoryStore(),
    );
  if (redis) return new RedisStore(redis);
  return new MemoryStore(
    process.env.VERCEL ? undefined : resolve(process.cwd(), 'data/state.json'),
  );
}

export const store = createStore();
export const storageKind = config.databaseUrl
  ? 'postgres'
  : redis
    ? 'redis'
    : 'memory';

export async function loadStore() {
  if (store instanceof MemoryStore) await store.load();
}
