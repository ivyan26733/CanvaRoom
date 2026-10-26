import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PAGES,
  MAX_MESSAGES,
  MAX_SNAPSHOTS,
  ACTIVE_GAP_MS,
  planOf,
  providerOf,
  TRIAL_SECONDS,
} from './models.js';
import type {
  Account,
  AccountRole,
  AdminBankTransferRequest,
  BankTransferRequest,
  BankTransferReviewResult,
  BoardMeta,
  BoardObject,
  Capture,
  CaptureResult,
  CheckoutReminder,
  ChatMessage,
  Member,
  Operation,
  Page,
  Feedback,
  Payment,
  PaymentProvider,
  PremiumReminder,
  Presence,
  RefundResult,
  SessionRecord,
  Snapshot,
} from './models.js';
import type { BoardListItem, LiveStore, Store } from './store.js';
import {
  PLANS_SINCE,
  planOfOrder,
  termOfPlan,
  termOfOrder,
  type PremiumPlan,
} from './plans.js';

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
  emailVerified: 'email_verified',
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
  owner_exists: boolean | null;
  owner_trial_used_seconds: number | null;
  owner_trial_beat_at: Date | null;
  owner_paid_until: Date | null;
  owner_first_board: boolean | null;
};

type AccountRow = {
  id: string;
  email: string;
  role: AccountRole;
  email_verified: boolean;
  name: string;
  color: string;
  password_hash: string;
  created_at: Date;
  trial_ends_at: Date | null;
  trial_used_seconds: number | null;
  trial_beat_at: Date | null;
  paid_until: Date | null;
};

const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  email: row.email,
  role: row.role,
  emailVerified: row.email_verified,
  name: row.name,
  color: row.color,
  passwordHash: row.password_hash,
  createdAt: iso(row.created_at),
  ...(row.trial_ends_at ? { trialEndsAt: iso(row.trial_ends_at) } : {}),
  ...(row.trial_used_seconds !== null
    ? { trialUsedSeconds: row.trial_used_seconds }
    : {}),
  ...(row.trial_beat_at ? { trialBeatAt: iso(row.trial_beat_at) } : {}),
  ...(row.paid_until ? { paidUntil: iso(row.paid_until) } : {}),
});

type PaymentRow = {
  order_id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: Payment['status'];
  // Missing until the database is migrated for the 3/6/12-month plans.
  plan?: string | null;
  months?: number | null;
  days?: number | null;
  payment_id: string | null;
  created_at: Date;
  paid_at: Date | null;
  // Missing until the database is migrated for PayPal.
  provider?: string | null;
  refunded_at?: Date | null;
};

type BankTransferRow = {
  id: string;
  user_id: string;
  plan: string;
  amount: number;
  currency: 'USD';
  months: number;
  days: number;
  reference: string;
  status: BankTransferRequest['status'];
  sender_reference: string | null;
  created_at: Date;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  paid_until: Date | null;
};

/** Postgres's "undefined column": the database isn't migrated yet. */
const missingColumn = (error: unknown) =>
  (error as { code?: string } | null)?.code === '42703';

const toPayment = (row: PaymentRow): Payment => ({
  orderId: row.order_id,
  userId: row.user_id,
  amount: row.amount,
  currency: row.currency,
  status: row.status,
  ...(row.plan ? { plan: row.plan } : {}),
  ...(row.months != null ? { months: row.months } : {}),
  ...(row.days != null ? { days: row.days } : {}),
  createdAt: iso(row.created_at),
  ...(row.payment_id ? { paymentId: row.payment_id } : {}),
  ...(row.paid_at ? { paidAt: iso(row.paid_at) } : {}),
  ...(row.provider === 'razorpay' || row.provider === 'paypal'
    ? { provider: row.provider }
    : {}),
  ...(row.refunded_at ? { refundedAt: iso(row.refunded_at) } : {}),
});

const toBankTransferRequest = (row: BankTransferRow): BankTransferRequest => ({
  id: row.id,
  userId: row.user_id,
  plan: row.plan,
  amount: row.amount,
  currency: row.currency,
  months: row.months,
  days: row.days,
  reference: row.reference,
  status: row.status,
  ...(row.sender_reference ? { senderReference: row.sender_reference } : {}),
  createdAt: iso(row.created_at),
  ...(row.submitted_at ? { submittedAt: iso(row.submitted_at) } : {}),
  ...(row.reviewed_at ? { reviewedAt: iso(row.reviewed_at) } : {}),
  ...(row.reviewed_by ? { reviewedBy: row.reviewed_by } : {}),
  ...(row.paid_until ? { paidUntil: iso(row.paid_until) } : {}),
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
                 FROM board_members m WHERE m.board_id = b.id) AS members,
              a.id IS NOT NULL AS owner_exists,
              a.trial_used_seconds AS owner_trial_used_seconds,
              a.trial_beat_at AS owner_trial_beat_at,
              a.paid_until AS owner_paid_until,
              (SELECT f.id FROM boards f WHERE f.owner_id = b.owner_id
                ORDER BY f.created_at, f.id LIMIT 1) = b.id AS owner_first_board
         FROM boards b LEFT JOIN accounts a ON a.id = b.owner_id
        WHERE b.id = $1`,
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
      ...(row.owner_exists
        ? {
            ownerPlan: {
              trialUsedSeconds: row.owner_trial_used_seconds ?? TRIAL_SECONDS,
              ...(row.owner_trial_beat_at
                ? { trialBeatAt: iso(row.owner_trial_beat_at) }
                : {}),
              ...(row.owner_paid_until
                ? { paidUntil: iso(row.owner_paid_until) }
                : {}),
            },
          }
        : {}),
      ownerFirstBoard: row.owner_first_board ?? false,
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

  async listSnapshots(boardId: string) {
    const { rows } = await this.pool.query<{
      id: string;
      title: string;
      created_at: string;
    }>(
      `SELECT data->>'id' AS id, data->>'title' AS title, data->>'createdAt' AS created_at
         FROM board_snapshots WHERE board_id = $1 ORDER BY seq`,
      [boardId],
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
    }));
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
      `INSERT INTO accounts (id, email, name, color, password_hash, created_at, trial_used_seconds, email_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [
        account.id,
        account.email,
        account.name,
        account.color,
        account.passwordHash,
        account.createdAt,
        account.trialUsedSeconds ?? 0,
        account.emailVerified ?? true,
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

  async getSessionAccount(key: string) {
    const { rows } = await this.pool.query<
      Partial<AccountRow> & {
        session_user_id: string;
        guest: SessionRecord['guest'] | null;
      }
    >(
      `SELECT s.user_id AS session_user_id, s.guest, a.*
         FROM sessions s
         LEFT JOIN accounts a ON a.id = s.user_id AND s.guest IS NULL
        WHERE s.key = $1 AND s.expires_at > now()`,
      [key],
    );
    const row = rows[0];
    if (!row) return;
    return {
      session: {
        userId: row.session_user_id,
        ...(row.guest ? { guest: row.guest } : {}),
      } satisfies SessionRecord,
      ...(row.id ? { account: toAccount(row as AccountRow) } : {}),
    };
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

  async changeEmail(userId: string, email: string) {
    try {
      const { rowCount } = await this.pool.query(
        `UPDATE accounts SET email = $2 WHERE id = $1`,
        [userId, email],
      );
      return rowCount === 1;
    } catch (error) {
      // Another account already uses the address.
      if ((error as { code?: string }).code === '23505') return false;
      throw error;
    }
  }

  async createVerificationToken(key: string, userId: string, ttl: number) {
    await this.pool.query(
      `INSERT INTO email_verification_tokens (key, user_id, expires_at)
       VALUES ($1, $2, now() + make_interval(secs => $3))
       ON CONFLICT (user_id) DO UPDATE SET key = EXCLUDED.key, expires_at = EXCLUDED.expires_at`,
      [key, userId, ttl],
    );
  }

  async verifyEmailToken(key: string) {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `WITH consumed AS (
         DELETE FROM email_verification_tokens
          WHERE key = $1 AND expires_at > now()
          RETURNING user_id
       ), verified AS (
         UPDATE accounts SET email_verified = true
          WHERE id IN (SELECT user_id FROM consumed)
          RETURNING id
       ) SELECT id AS user_id FROM verified`,
      [key],
    );
    return rows[0]?.user_id;
  }

  async completePasswordReset(key: string, passwordHash: string) {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `WITH consumed AS (
         DELETE FROM reset_tokens WHERE key = $1 AND expires_at > now()
         RETURNING user_id
       ), updated AS (
         -- Receiving the code proves the address, too.
         UPDATE accounts SET password_hash = $2, email_verified = true
          WHERE id IN (SELECT user_id FROM consumed)
          RETURNING id
       ), revoked AS (
         DELETE FROM sessions WHERE user_id IN (SELECT id FROM updated)
         RETURNING user_id
       ) SELECT id AS user_id FROM updated`,
      [key, passwordHash],
    );
    return rows[0]?.user_id;
  }

  async takeResetToken(key: string) {
    // Only the most recently requested link exists, and using it removes it.
    const { rows } = await this.pool.query<{ user_id: string; live: boolean }>(
      `DELETE FROM reset_tokens WHERE key = $1 RETURNING user_id, expires_at > now() AS live`,
      [key],
    );
    return rows[0]?.live ? rows[0].user_id : undefined;
  }

  async addFeedback(feedback: Feedback) {
    await this.pool.query(
      `INSERT INTO feedback (id, user_id, email, name, category, rating, message, page, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        feedback.id,
        feedback.userId ?? null,
        feedback.email,
        feedback.name ?? null,
        feedback.category,
        feedback.rating ?? null,
        feedback.message,
        feedback.page ?? null,
        feedback.createdAt,
      ],
    );
  }

  async listLibrary(userId: string) {
    const { rows } = await this.pool.query<{ pack_id: string }>(
      `SELECT pack_id FROM account_library WHERE account_id = $1
        ORDER BY installed_at, pack_id`,
      [userId],
    );
    return rows.map((row) => row.pack_id);
  }

  async setLibraryPack(userId: string, packId: string, installed: boolean) {
    await this.pool.query(
      installed
        ? `INSERT INTO account_library (account_id, pack_id, installed_at)
           VALUES ($1, $2, now()) ON CONFLICT DO NOTHING`
        : `DELETE FROM account_library WHERE account_id = $1 AND pack_id = $2`,
      [userId, packId],
    );
  }

  async markFeedbackMailed(id: string) {
    await this.pool.query(`UPDATE feedback SET mailed = true WHERE id = $1`, [
      id,
    ]);
  }

  async createPayment(payment: Payment) {
    const values = [
      payment.orderId,
      payment.userId,
      payment.amount,
      payment.currency,
      payment.status,
      payment.createdAt,
    ];
    const plan = [
      payment.plan ?? null,
      payment.months ?? null,
      payment.days ?? null,
    ];
    // Each step back drops columns a database not yet migrated lacks. The
    // provider can still be told from the order ID, and the plan from the
    // amount.
    const attempts: [string, unknown[]][] = [
      [
        `INSERT INTO payments (order_id, user_id, amount, currency, status, created_at, plan, months, days, provider)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [...values, ...plan, providerOf(payment)],
      ],
      [
        `INSERT INTO payments (order_id, user_id, amount, currency, status, created_at, plan, months, days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [...values, ...plan],
      ],
      [
        `INSERT INTO payments (order_id, user_id, amount, currency, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        values,
      ],
    ];
    for (const [index, [sql, params]] of attempts.entries()) {
      try {
        await this.pool.query(sql, params);
        return;
      } catch (error) {
        if (!missingColumn(error) || index === attempts.length - 1) throw error;
      }
    }
  }

  async accrueTrial(userId: string) {
    // Adds the time since the last beat when it is short enough to mean the
    // person was active throughout, in one statement so beats from several
    // tabs or instances never count the same seconds twice.
    const { rows } = await this.pool.query<AccountRow>(
      `UPDATE accounts SET
          trial_used_seconds = least($2::float8, trial_used_seconds + CASE
            WHEN trial_beat_at IS NOT NULL
             AND trial_beat_at >= now() - make_interval(secs => $3)
             AND trial_beat_at <= now()
            THEN extract(epoch FROM now() - trial_beat_at)
            ELSE 0 END),
          trial_beat_at = now()
        WHERE id = $1
          AND trial_used_seconds < $2
          AND (paid_until IS NULL OR paid_until <= now())
        RETURNING *`,
      [userId, TRIAL_SECONDS, ACTIVE_GAP_MS / 1000],
    );
    const account = rows[0]
      ? toAccount(rows[0])
      : await this.getAccount(userId);
    return account && planOf(account);
  }

  async getPayment(orderId: string) {
    const { rows } = await this.pool.query<PaymentRow>(
      `SELECT * FROM payments WHERE order_id = $1`,
      [orderId],
    );
    return rows[0] && toPayment(rows[0]);
  }

  async openOrder(
    userId: string,
    plan: PremiumPlan,
    minutes: number,
    provider: PaymentProvider,
  ) {
    const { rows } = await this.pool.query<PaymentRow>(
      `SELECT * FROM payments
        WHERE user_id = $1 AND status = 'created'
          AND amount = $2 AND currency = $3
          AND created_at > now() - make_interval(mins => $4)
          AND created_at >= $5
        ORDER BY created_at DESC
        LIMIT 5`,
      [
        userId,
        plan.amount,
        plan.currency,
        minutes,
        new Date(PLANS_SINCE).toISOString(),
      ],
    );
    return rows
      .map(toPayment)
      .find(
        (payment) =>
          providerOf(payment) === provider &&
          planOfOrder(payment)?.id === plan.id,
      );
  }

  async recordPayment(
    capture: Capture,
    legacyDays: number,
  ): Promise<CaptureResult> {
    // One transaction, locking the order and then the account (always in
    // that order, so two payments can't deadlock). The checkout, the webhook
    // and a retry of either can arrive together: whichever locks the order
    // first applies the payment, and the rest find it paid. Two different
    // orders for one account each wait for the account row, so each extends
    // the pass from where the other left it.
    return this.transaction(async (client): Promise<CaptureResult> => {
      const { rows } = await client.query<PaymentRow>(
        `SELECT * FROM payments WHERE order_id = $1 FOR UPDATE`,
        [capture.orderId],
      );
      const order = rows[0];
      if (!order) return { outcome: 'unknown' };
      const userId = order.user_id;
      if (
        capture.amount !== undefined &&
        (capture.amount !== order.amount || capture.currency !== order.currency)
      )
        return { outcome: 'mismatch', userId };
      if (order.status === 'paid') {
        if (order.payment_id === capture.paymentId)
          return { outcome: 'repeat', userId };
        await this.logCapture(client, capture, order, false);
        return { outcome: 'extra', userId };
      }
      // The plan stored on the order decides the time, in calendar months
      // and then days, from the later of now and the current end.
      const term = termOfOrder(toPayment(order), legacyDays);
      const account = await client.query<{ paid_until: Date }>(
        `UPDATE accounts
            SET paid_until = greatest(paid_until, now())
                  + make_interval(months => $2, days => $3)
          WHERE id = $1
          RETURNING paid_until`,
        [userId, term.months, term.days],
      );
      if (!account.rows[0]) return { outcome: 'unknown' };
      await client.query(
        `UPDATE payments SET status = 'paid', payment_id = $2, paid_at = now()
          WHERE order_id = $1`,
        [capture.orderId, capture.paymentId],
      );
      await this.logCapture(client, capture, order, true);
      return {
        outcome: 'applied',
        userId,
        paidUntil: iso(account.rows[0].paid_until),
      };
    });
  }

  async refundPayment(
    refund: { paymentId: string; amount: number; currency: string },
    legacyDays: number,
  ): Promise<RefundResult> {
    // Locks the order, then the account, like recordPayment, so a refund and
    // a payment for one account can't deadlock.
    return this.transaction(async (client): Promise<RefundResult> => {
      const { rows } = await client.query<PaymentRow>(
        `SELECT * FROM payments
          WHERE payment_id = $1 AND status = 'paid'
          FOR UPDATE`,
        [refund.paymentId],
      );
      const order = rows[0];
      if (!order) return { outcome: 'unknown' };
      // Without the column there is nowhere to remember the refund.
      if (!('refunded_at' in order)) return { outcome: 'unmigrated' };
      const userId = order.user_id;
      if (order.refunded_at) return { outcome: 'repeat', userId };
      if (refund.currency !== order.currency || refund.amount < order.amount)
        return { outcome: 'partial', userId };
      const term = termOfOrder(toPayment(order), legacyDays);
      const account = await client.query<{ paid_until: Date | null }>(
        `UPDATE accounts
            SET paid_until = greatest(now(),
                  -- The reverse of adding months then days: days come off first.
                  paid_until - make_interval(days => $3)
                    - make_interval(months => $2))
          WHERE id = $1 AND paid_until IS NOT NULL
          RETURNING paid_until`,
        [userId, term.months, term.days],
      );
      await client.query(
        `UPDATE payments SET refunded_at = now() WHERE order_id = $1`,
        [order.order_id],
      );
      const paidUntil = account.rows[0]?.paid_until;
      return {
        outcome: 'refunded',
        userId,
        ...(paidUntil ? { paidUntil: iso(paidUntil) } : {}),
      };
    });
  }

  async claimPremiumReminders(withinDays: number, limit: number) {
    // Marking and returning in one statement means two overlapping runs
    // can't both remind the same account.
    const { rows } = await this.pool.query<{
      id: string;
      email: string;
      name: string;
      paid_until: Date;
    }>(
      `UPDATE accounts SET premium_reminded_for = paid_until
        WHERE id IN (
          SELECT id FROM accounts
           WHERE paid_until > now()
             AND paid_until <= now() + make_interval(days => $1)
             AND premium_reminded_for IS DISTINCT FROM paid_until
             AND email <> ''
           ORDER BY paid_until
           LIMIT $2
           FOR UPDATE SKIP LOCKED)
        RETURNING id, email, name, paid_until`,
      [withinDays, limit],
    );
    return rows.map((row): PremiumReminder => ({
      userId: row.id,
      email: row.email,
      name: row.name,
      paidUntil: iso(row.paid_until),
    }));
  }

  async releasePremiumReminder(userId: string, paidUntil: string) {
    await this.pool.query(
      `UPDATE accounts SET premium_reminded_for = NULL
        WHERE id = $1 AND premium_reminded_for = $2`,
      [userId, paidUntil],
    );
  }

  async claimCheckoutReminders(olderThanHours: number, limit: number) {
    const { rows } = await this.pool.query<{
      order_id: string;
      user_id: string;
      email: string;
      name: string;
      plan: string | null;
      created_at: Date;
    }>(
      `WITH due AS (
         SELECT p.order_id
           FROM payments p
           JOIN accounts a ON a.id = p.user_id
          WHERE p.status = 'created'
            AND p.created_at <= now() - make_interval(hours => $1)
            AND p.checkout_reminded_at IS NULL
            AND (p.checkout_reminder_claimed_at IS NULL
              OR p.checkout_reminder_claimed_at < now() - interval '6 hours')
            AND btrim(a.email) <> ''
            AND NOT EXISTS (
              SELECT 1 FROM payments newer
               WHERE newer.user_id = p.user_id
                 AND newer.status = 'created'
                 AND newer.created_at <= now() - make_interval(hours => $1)
                 AND newer.checkout_reminded_at IS NULL
                 AND newer.created_at > p.created_at
            )
          ORDER BY p.created_at
          LIMIT $2
          FOR UPDATE OF p SKIP LOCKED
       ), claimed AS (
         UPDATE payments p
            SET checkout_reminder_claimed_at = now()
           FROM due d
          WHERE p.order_id = d.order_id
         RETURNING p.order_id, p.user_id, p.plan, p.created_at
       )
       SELECT c.order_id, c.user_id, a.email, a.name, c.plan, c.created_at
         FROM claimed c
         JOIN accounts a ON a.id = c.user_id`,
      [olderThanHours, limit],
    );
    return rows.map((row): CheckoutReminder => ({
      orderId: row.order_id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      ...(row.plan ? { plan: row.plan } : {}),
      createdAt: iso(row.created_at),
    }));
  }

  async markCheckoutReminderSent(orderId: string) {
    await this.pool.query(
      `UPDATE payments
          SET checkout_reminded_at = now(), checkout_reminder_claimed_at = NULL
        WHERE order_id IN (
          SELECT older.order_id
            FROM payments selected
            JOIN payments older
              ON older.user_id = selected.user_id
             AND older.status = 'created'
             AND older.created_at <= selected.created_at
             AND older.checkout_reminded_at IS NULL
           WHERE selected.order_id = $1
        )`,
      [orderId],
    );
  }

  async releaseCheckoutReminder(orderId: string) {
    await this.pool.query(
      `UPDATE payments SET checkout_reminder_claimed_at = NULL
        WHERE order_id = $1 AND checkout_reminded_at IS NULL`,
      [orderId],
    );
  }

  async recordAccountActivity(userId: string) {
    await this.pool.query(
      `UPDATE accounts SET last_seen_at = now()
        WHERE id = $1
          AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')`,
      [userId],
    );
  }

  async createAdminSession(key: string, username: string, ttlSeconds: number) {
    await this.pool.query(
      'DELETE FROM admin_sessions WHERE expires_at <= now()',
    );
    await this.pool.query(
      `INSERT INTO admin_sessions (key, username, expires_at)
       VALUES ($1, $2, now() + make_interval(secs => $3))`,
      [key, username, ttlSeconds],
    );
  }

  async getAdminSession(key: string) {
    const { rows } = await this.pool.query<{ username: string }>(
      `SELECT username FROM admin_sessions WHERE key = $1 AND expires_at > now()`,
      [key],
    );
    return rows[0]?.username;
  }

  async deleteAdminSession(key: string) {
    await this.pool.query('DELETE FROM admin_sessions WHERE key = $1', [key]);
  }

  async createBankTransferRequest(input: {
    id: string;
    userId: string;
    plan: PremiumPlan;
    reference: string;
  }) {
    return this.transaction(async (client) => {
      const account = await client.query<{ id: string }>(
        'SELECT id FROM accounts WHERE id = $1 FOR UPDATE',
        [input.userId],
      );
      if (!account.rows[0]) return undefined;
      const existing = await client.query<BankTransferRow>(
        `SELECT * FROM bank_transfer_requests
          WHERE user_id = $1 AND plan = $2
            AND status IN ('instructions', 'pending')
          ORDER BY created_at DESC LIMIT 1`,
        [input.userId, input.plan.id],
      );
      if (existing.rows[0]) return toBankTransferRequest(existing.rows[0]);
      const { months, days } = termOfPlan(input.plan);
      const { rows } = await client.query<BankTransferRow>(
        `INSERT INTO bank_transfer_requests
           (id, user_id, plan, amount, currency, months, days, reference, status)
         VALUES ($1, $2, $3, $4, 'USD', $5, $6, $7, 'instructions')
         RETURNING *`,
        [
          input.id,
          input.userId,
          input.plan.id,
          input.plan.amount,
          months,
          days,
          input.reference,
        ],
      );
      return toBankTransferRequest(rows[0]!);
    });
  }

  async submitBankTransferRequest(
    id: string,
    userId: string,
    senderReference?: string,
  ) {
    return this.transaction(async (client) => {
      const { rows } = await client.query<BankTransferRow>(
        `SELECT * FROM bank_transfer_requests
          WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, userId],
      );
      const request = rows[0];
      if (!request) return undefined;
      if (request.status === 'instructions') {
        const updated = await client.query<BankTransferRow>(
          `UPDATE bank_transfer_requests
              SET status = 'pending', sender_reference = $2, submitted_at = now()
            WHERE id = $1 RETURNING *`,
          [id, senderReference ?? null],
        );
        return toBankTransferRequest(updated.rows[0]!);
      }
      return toBankTransferRequest(request);
    });
  }

  async listAdminBankTransfers(): Promise<AdminBankTransferRequest[]> {
    const { rows } = await this.pool.query<
      BankTransferRow & { email: string; name: string }
    >(
      `SELECT r.*, a.email, a.name
         FROM bank_transfer_requests r
         JOIN accounts a ON a.id = r.user_id
        WHERE r.status = 'pending'
        ORDER BY r.submitted_at, r.created_at
        LIMIT 200`,
    );
    return rows.map((row) => ({
      ...toBankTransferRequest(row),
      email: row.email,
      name: row.name,
    }));
  }

  async confirmBankTransfer(
    id: string,
    username: string,
    grantId: string,
  ): Promise<BankTransferReviewResult> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<BankTransferRow>(
        `SELECT * FROM bank_transfer_requests WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const request = rows[0];
      if (!request) return { outcome: 'unknown' };
      if (request.status === 'confirmed')
        return {
          outcome: 'repeat',
          userId: request.user_id,
          ...(request.paid_until ? { paidUntil: iso(request.paid_until) } : {}),
        };
      if (request.status !== 'pending')
        return { outcome: 'not_pending', userId: request.user_id };
      const account = await client.query<{ paid_until: Date | null }>(
        'SELECT paid_until FROM accounts WHERE id = $1 FOR UPDATE',
        [request.user_id],
      );
      if (!account.rows[0]) return { outcome: 'unknown' };
      const previous = account.rows[0].paid_until;
      const updated = await client.query<{ paid_until: Date }>(
        `UPDATE accounts
            SET paid_until = greatest(coalesce(paid_until, now()), now())
                  + make_interval(months => $2, days => $3)
          WHERE id = $1 RETURNING paid_until`,
        [request.user_id, request.months, request.days],
      );
      const paidUntil = updated.rows[0]!.paid_until;
      const note = request.sender_reference
        ? `Sender reference: ${request.sender_reference}`
        : 'USD bank transfer confirmed';
      await client.query(
        `INSERT INTO admin_access_grants
           (id, admin_username, user_id, months, days, method, reference, note,
            previous_paid_until, paid_until)
         VALUES ($1, $2, $3, $4, $5, 'bank_transfer', $6, $7, $8, $9)`,
        [
          grantId,
          username,
          request.user_id,
          request.months,
          request.days,
          request.reference,
          note,
          previous,
          paidUntil,
        ],
      );
      await client.query(
        `UPDATE bank_transfer_requests
            SET status = 'confirmed', reviewed_at = now(), reviewed_by = $2,
                paid_until = $3
          WHERE id = $1`,
        [id, username, paidUntil],
      );
      return {
        outcome: 'confirmed',
        userId: request.user_id,
        paidUntil: iso(paidUntil),
      };
    });
  }

  async rejectBankTransfer(
    id: string,
    username: string,
  ): Promise<BankTransferReviewResult> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<BankTransferRow>(
        `SELECT * FROM bank_transfer_requests WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const request = rows[0];
      if (!request) return { outcome: 'unknown' };
      if (request.status !== 'pending')
        return { outcome: 'not_pending', userId: request.user_id };
      await client.query(
        `UPDATE bank_transfer_requests
            SET status = 'rejected', reviewed_at = now(), reviewed_by = $2
          WHERE id = $1`,
        [id, username],
      );
      return { outcome: 'rejected', userId: request.user_id };
    });
  }

  async listAdminAccounts(search: string, limit: number, offset: number) {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.email, a.role, a.email_verified, a.name, a.created_at,
              a.last_seen_at, a.trial_used_seconds, a.paid_until,
              (SELECT count(*)::int FROM payments p WHERE p.user_id = a.id) AS payment_count,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'provider', recent.provider, 'status', recent.status,
                 'plan', recent.plan, 'months', recent.months, 'days', recent.days,
                 'amount', recent.amount, 'currency', recent.currency,
                 'createdAt', recent.created_at, 'paidAt', recent.paid_at,
                 'refundedAt', recent.refunded_at
               ) ORDER BY recent.created_at DESC), '[]'::jsonb)
                 FROM (SELECT provider, status, plan, months, days, amount, currency,
                              created_at, paid_at, refunded_at
                         FROM payments WHERE user_id = a.id
                        ORDER BY created_at DESC LIMIT 10) recent) AS payments,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'id', g.id, 'adminUsername', g.admin_username,
                 'months', g.months, 'days', g.days, 'method', g.method,
                 'reference', g.reference, 'note', g.note,
                 'paidUntil', g.paid_until, 'createdAt', g.created_at
               ) ORDER BY g.created_at DESC), '[]'::jsonb)
                 FROM (SELECT * FROM admin_access_grants WHERE user_id = a.id
                        ORDER BY created_at DESC LIMIT 10) g) AS grants,
              count(*) OVER()::int AS total
         FROM accounts a
        WHERE $1 = '' OR a.id ILIKE '%' || $1 || '%'
           OR a.email ILIKE '%' || $1 || '%' OR a.name ILIKE '%' || $1 || '%'
        ORDER BY a.created_at DESC, a.id
        LIMIT $2 OFFSET $3`,
      [search, limit, offset],
    );
    return {
      total: rows[0]?.total ?? 0,
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        emailVerified: row.email_verified,
        name: row.name,
        createdAt: iso(row.created_at),
        lastSeenAt: row.last_seen_at ? iso(row.last_seen_at) : null,
        trialUsedSeconds: row.trial_used_seconds ?? 1800,
        paidUntil: row.paid_until ? iso(row.paid_until) : null,
        paymentCount: row.payment_count,
        payments: row.payments,
        grants: row.grants,
      })),
    };
  }

  async grantAdminAccess(input: {
    id: string;
    username: string;
    userId: string;
    months: number;
    days: number;
    method: string;
    reference?: string;
    note?: string;
  }) {
    return this.transaction(async (client) => {
      const account = await client.query<{ paid_until: Date | null }>(
        'SELECT paid_until FROM accounts WHERE id = $1 FOR UPDATE',
        [input.userId],
      );
      if (!account.rows[0]) return undefined;
      const previous = account.rows[0].paid_until;
      const updated = await client.query<{ paid_until: Date }>(
        `UPDATE accounts SET paid_until = greatest(coalesce(paid_until, now()), now())
             + make_interval(months => $2, days => $3)
          WHERE id = $1 RETURNING paid_until`,
        [input.userId, input.months, input.days],
      );
      const paidUntil = updated.rows[0]!.paid_until;
      await client.query(
        `INSERT INTO admin_access_grants
           (id, admin_username, user_id, months, days, method, reference, note,
            previous_paid_until, paid_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.id,
          input.username,
          input.userId,
          input.months,
          input.days,
          input.method,
          input.reference ?? null,
          input.note ?? null,
          previous,
          paidUntil,
        ],
      );
      return iso(paidUntil);
    });
  }

  /**
   * Keeps every capture in a ledger, including extra payments on an order
   * that was already paid, which need refunding. Written under a savepoint so
   * a database that hasn't been migrated yet still records the payment.
   */
  private async logCapture(
    client: pg.PoolClient,
    capture: Capture,
    order: PaymentRow,
    applied: boolean,
  ) {
    await client.query('SAVEPOINT capture_log');
    try {
      await client.query(
        `INSERT INTO payment_captures
           (payment_id, order_id, user_id, amount, currency, source, applied)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (payment_id) DO NOTHING`,
        [
          capture.paymentId,
          capture.orderId,
          order.user_id,
          capture.amount ?? order.amount,
          capture.currency ?? order.currency,
          capture.source,
          applied,
        ],
      );
      await client.query('RELEASE SAVEPOINT capture_log');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT capture_log');
      console.error('Could not log a payment capture', error);
    }
  }
}
