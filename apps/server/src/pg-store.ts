import type pg from 'pg';
import { DEFAULT_PAGES, MAX_MESSAGES, MAX_SNAPSHOTS } from './models.js';
import type {
  Account,
  BoardMeta,
  BoardObject,
  ChatMessage,
  Member,
  Operation,
  Page,
  Presence,
  SessionRecord,
  Snapshot,
} from './models.js';
import type { BoardListItem, LiveStore, Store } from './store.js';

const iso = (value: Date | string) => new Date(value).toISOString();

// Fields of BoardMeta that may change, and the columns that hold them.
const metaColumns = {
  title: 'title',
  locked: 'locked',
  inviteToken: 'invite_token',
  inviteRevoked: 'invite_revoked',
  updatedAt: 'updated_at',
  pages: 'pages',
} as const;

const accountColumns = {
  name: 'name',
  color: 'color',
  passwordHash: 'password_hash',
} as const;

type BoardRow = {
  id: string;
  title: string;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
  locked: boolean;
  invite_token: string;
  invite_revoked: boolean;
  pages: Page[] | null;
  members: Record<string, Member> | null;
};

type AccountRow = {
  id: string;
  email: string;
  name: string;
  color: string;
  password_hash: string;
  created_at: Date;
};

const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  email: row.email,
  name: row.name,
  color: row.color,
  passwordHash: row.password_hash,
  createdAt: iso(row.created_at),
});

/** Builds `SET a = $2, b = $3` from the fields that are present. */
function assignments(
  fields: Record<string, unknown>,
  columns: Record<string, string>,
  offset: number,
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [field, column] of Object.entries(columns)) {
    const value = fields[field];
    if (value === undefined) continue;
    values.push(field === 'pages' ? JSON.stringify(value) : value);
    sets.push(`${column} = $${offset + values.length}`);
  }
  return { sets: sets.join(', '), values };
}

// Inserts objects in array order, so `seq` keeps their stacking order.
const insertObjects = `
INSERT INTO board_objects (board_id, id, data)
SELECT $1, item->>'id', item
FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS t(item, position)
ORDER BY position
ON CONFLICT DO NOTHING`;

/**
 * Durable data in Postgres. Presence and rate-limit counters change many
 * times a second and expire on their own, so they stay in `live` (Redis).
 */
export class PostgresStore implements Store {
  constructor(
    private readonly pool: pg.Pool,
    private readonly live: LiveStore,
  ) {}

  private async transaction<T>(work: (client: pg.PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createBoard(meta: BoardMeta, objects: BoardObject[]) {
    await this.transaction(async (client) => {
      await client.query(
        `INSERT INTO boards (id, title, owner_id, created_at, updated_at, locked, invite_token, invite_revoked, pages)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          meta.id,
          meta.title,
          meta.ownerId,
          meta.createdAt,
          meta.updatedAt,
          meta.locked,
          meta.inviteToken,
          meta.inviteRevoked,
          JSON.stringify(meta.pages),
        ],
      );
      for (const [userId, member] of Object.entries(meta.members))
        await client.query(
          `INSERT INTO board_members (board_id, user_id, role, name) VALUES ($1, $2, $3, $4)`,
          [meta.id, userId, member.role, member.name],
        );
      if (objects.length)
        await client.query(insertObjects, [meta.id, JSON.stringify(objects)]);
    });
  }

  async getMeta(boardId: string) {
    const { rows } = await this.pool.query<BoardRow>(
      `SELECT b.*,
              (SELECT jsonb_object_agg(m.user_id, jsonb_build_object('role', m.role, 'name', m.name))
                 FROM board_members m WHERE m.board_id = b.id) AS members
         FROM boards b WHERE b.id = $1`,
      [boardId],
    );
    const row = rows[0];
    if (!row) return;
    return {
      id: row.id,
      title: row.title,
      ownerId: row.owner_id,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      locked: row.locked,
      inviteToken: row.invite_token,
      inviteRevoked: row.invite_revoked,
      pages: row.pages?.length ? row.pages : DEFAULT_PAGES,
      members: row.members ?? {},
    } satisfies BoardMeta;
  }

  async updateMeta(boardId: string, fields: Partial<BoardMeta>) {
    const { sets, values } = assignments(fields, metaColumns, 1);
    if (!sets) return;
    await this.pool.query(`UPDATE boards SET ${sets} WHERE id = $1`, [
      boardId,
      ...values,
    ]);
  }

  async setMember(boardId: string, userId: string, member: Member) {
    await this.pool.query(
      `INSERT INTO board_members (board_id, user_id, role, name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name`,
      [boardId, userId, member.role, member.name],
    );
  }

  async deleteBoard(boardId: string) {
    // Members, objects, chat, and snapshots go with it.
    await this.pool.query(`DELETE FROM boards WHERE id = $1`, [boardId]);
    for (const presence of await this.live.listPresence(boardId))
      await this.live.removePresence(boardId, presence.peerId);
  }

  async listBoards(userId: string) {
    const { rows } = await this.pool.query<{
      id: string;
      title: string;
      role: Member['role'];
      locked: boolean;
      updated_at: Date;
      object_count: number;
    }>(
      `SELECT b.id, b.title, m.role, b.locked, b.updated_at,
              (SELECT count(*)::int FROM board_objects o WHERE o.board_id = b.id) AS object_count
         FROM board_members m JOIN boards b ON b.id = m.board_id
        WHERE m.user_id = $1
        ORDER BY b.updated_at DESC`,
      [userId],
    );
    return rows.map((row): BoardListItem => ({
      id: row.id,
      title: row.title,
      role: row.role,
      locked: row.locked,
      updatedAt: iso(row.updated_at),
      objectCount: row.object_count,
    }));
  }

  async getObjects(boardId: string) {
    const { rows } = await this.pool.query<{ data: BoardObject }>(
      `SELECT data FROM board_objects WHERE board_id = $1 ORDER BY seq`,
      [boardId],
    );
    return rows.map((row) => row.data);
  }

  async applyOperation(boardId: string, operation: Operation) {
    const now = new Date().toISOString();
    // Each statement is atomic on its own: deleted IDs are never recreated,
    // and updates merge fields into the stored object.
    const sql =
      operation.type === 'delete'
        ? `WITH tomb AS (
             INSERT INTO board_tombstones (board_id, id) VALUES ($1, $2) ON CONFLICT DO NOTHING
           ), gone AS (
             DELETE FROM board_objects WHERE board_id = $1 AND id = $2 RETURNING 1
           ), touch AS (
             UPDATE boards SET updated_at = $3 WHERE id = $1
           )
           SELECT count(*)::int AS changed FROM gone`
        : operation.type === 'create'
          ? `WITH made AS (
               INSERT INTO board_objects (board_id, id, data)
               SELECT $1, $2, $4::jsonb
                WHERE NOT EXISTS (SELECT 1 FROM board_tombstones WHERE board_id = $1 AND id = $2)
               ON CONFLICT DO NOTHING RETURNING 1
             ), touch AS (
               UPDATE boards SET updated_at = $3 WHERE id = $1 AND EXISTS (SELECT 1 FROM made)
             )
             SELECT count(*)::int AS changed FROM made`
          : `WITH changed AS (
               UPDATE board_objects SET data = data || $4::jsonb
                WHERE board_id = $1 AND id = $2 RETURNING 1
             ), touch AS (
               UPDATE boards SET updated_at = $3 WHERE id = $1 AND EXISTS (SELECT 1 FROM changed)
             )
             SELECT count(*)::int AS changed FROM changed`;
    const params: unknown[] = [boardId, operation.objectId, now];
    if (operation.type === 'create') {
      if (!operation.object) return false;
      params.push(JSON.stringify(operation.object));
    } else if (operation.type === 'update')
      params.push(JSON.stringify(operation.fields ?? {}));
    try {
      const { rows } = await this.pool.query<{ changed: number }>(sql, params);
      return (rows[0]?.changed ?? 0) > 0;
    } catch (error) {
      // The board was deleted while someone was still drawing on it.
      if ((error as { code?: string }).code === '23503') return false;
      throw error;
    }
  }

  async replaceObjects(boardId: string, objects: BoardObject[]) {
    await this.transaction(async (client) => {
      await client.query(
        `INSERT INTO board_tombstones (board_id, id)
         SELECT board_id, id FROM board_objects WHERE board_id = $1
         ON CONFLICT DO NOTHING`,
        [boardId],
      );
      await client.query(`DELETE FROM board_objects WHERE board_id = $1`, [
        boardId,
      ]);
      if (objects.length)
        await client.query(insertObjects, [boardId, JSON.stringify(objects)]);
      await client.query(`UPDATE boards SET updated_at = now() WHERE id = $1`, [
        boardId,
      ]);
    });
  }

  /** Appends to a capped, per-board list. */
  private async append(
    table: 'board_messages' | 'board_snapshots',
    boardId: string,
    data: unknown,
    keep: number,
  ) {
    await this.pool.query(
      `WITH added AS (
         INSERT INTO ${table} (board_id, data) VALUES ($1, $2) RETURNING seq
       )
       DELETE FROM ${table}
        WHERE board_id = $1
          AND seq <= (SELECT seq FROM ${table} WHERE board_id = $1
                       ORDER BY seq DESC OFFSET $3 LIMIT 1)`,
      [boardId, JSON.stringify(data), keep - 1],
    );
  }

  private async listOf<T>(
    table: 'board_messages' | 'board_snapshots',
    boardId: string,
  ) {
    const { rows } = await this.pool.query<{ data: T }>(
      `SELECT data FROM ${table} WHERE board_id = $1 ORDER BY seq`,
      [boardId],
    );
    return rows.map((row) => row.data);
  }

  async addMessage(boardId: string, message: ChatMessage) {
    await this.append('board_messages', boardId, message, MAX_MESSAGES);
  }

  async getMessages(boardId: string) {
    return this.listOf<ChatMessage>('board_messages', boardId);
  }

  async addSnapshot(boardId: string, snapshot: Snapshot) {
    await this.append('board_snapshots', boardId, snapshot, MAX_SNAPSHOTS);
  }

  async getSnapshots(boardId: string) {
    return this.listOf<Snapshot>('board_snapshots', boardId);
  }

  setPresence(boardId: string, presence: Presence) {
    return this.live.setPresence(boardId, presence);
  }

  removePresence(boardId: string, peerId: string) {
    return this.live.removePresence(boardId, peerId);
  }

  listPresence(boardId: string) {
    return this.live.listPresence(boardId);
  }

  hit(key: string, windowSeconds: number) {
    return this.live.hit(key, windowSeconds);
  }

  async createAccount(account: Account) {
    const { rowCount } = await this.pool.query(
      `INSERT INTO accounts (id, email, name, color, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [
        account.id,
        account.email,
        account.name,
        account.color,
        account.passwordHash,
        account.createdAt,
      ],
    );
    return rowCount === 1;
  }

  async getAccount(userId: string) {
    const { rows } = await this.pool.query<AccountRow>(
      `SELECT * FROM accounts WHERE id = $1`,
      [userId],
    );
    return rows[0] && toAccount(rows[0]);
  }

  async findAccountByEmail(email: string) {
    const { rows } = await this.pool.query<AccountRow>(
      `SELECT * FROM accounts WHERE email = $1`,
      [email],
    );
    return rows[0] && toAccount(rows[0]);
  }

  async updateAccount(userId: string, fields: Partial<Account>) {
    const { sets, values } = assignments(fields, accountColumns, 1);
    if (!sets) return;
    await this.pool.query(`UPDATE accounts SET ${sets} WHERE id = $1`, [
      userId,
      ...values,
    ]);
  }

  async boardIdsFor(userId: string) {
    const { rows } = await this.pool.query<{ board_id: string }>(
      `SELECT board_id FROM board_members WHERE user_id = $1`,
      [userId],
    );
    return rows.map((row) => row.board_id);
  }

  async createSession(key: string, record: SessionRecord, ttl: number) {
    await this.pool.query(
      `WITH expired AS (
         DELETE FROM sessions WHERE user_id = $2 AND expires_at < now()
       )
       INSERT INTO sessions (key, user_id, guest, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))
       ON CONFLICT (key) DO UPDATE
         SET user_id = EXCLUDED.user_id, guest = EXCLUDED.guest, expires_at = EXCLUDED.expires_at`,
      [
        key,
        record.userId,
        record.guest ? JSON.stringify(record.guest) : null,
        ttl,
      ],
    );
  }

  async getSession(key: string) {
    const { rows } = await this.pool.query<{
      user_id: string;
      guest: SessionRecord['guest'] | null;
    }>(
      `SELECT user_id, guest FROM sessions WHERE key = $1 AND expires_at > now()`,
      [key],
    );
    const row = rows[0];
    if (!row) return;
    return {
      userId: row.user_id,
      ...(row.guest ? { guest: row.guest } : {}),
    } satisfies SessionRecord;
  }

  async deleteSession(key: string) {
    await this.pool.query(`DELETE FROM sessions WHERE key = $1`, [key]);
  }

  async deleteSessionsFor(userId: string, keep?: string) {
    await this.pool.query(
      `DELETE FROM sessions WHERE user_id = $1 AND key IS DISTINCT FROM $2`,
      [userId, keep ?? null],
    );
  }

  async createResetToken(key: string, userId: string, ttl: number) {
    await this.pool.query(
      `INSERT INTO reset_tokens (key, user_id, expires_at)
       VALUES ($1, $2, now() + make_interval(secs => $3))
       ON CONFLICT (user_id) DO UPDATE SET key = EXCLUDED.key, expires_at = EXCLUDED.expires_at`,
      [key, userId, ttl],
    );
  }

  async takeResetToken(key: string) {
    // Only the most recently requested link exists, and using it removes it.
    const { rows } = await this.pool.query<{ user_id: string; live: boolean }>(
      `DELETE FROM reset_tokens WHERE key = $1 RETURNING user_id, expires_at > now() AS live`,
      [key],
    );
    return rows[0]?.live ? rows[0].user_id : undefined;
  }
}
