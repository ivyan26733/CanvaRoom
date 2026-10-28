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
  Notice,
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
import { classifyPoor, type BoardMetricRow } from './perf.js';
import type { BoardListItem, LiveStore, Store } from './store.js';
import {
  CURRENCIES,
  PLAN_IDS,
  PLANS_SINCE,
  planOfOrder,
  type Currency,
  type PlanId,
  type PriceSet,
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
  // Missing until the database is migrated for order expiry.
  last_event?: string | null;
  last_event_at?: Date | null;
  failure_reason?: string | null;
  expired_at?: Date | null;
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

export type AdminAccountFilter =
  'all' | 'online' | 'premium' | 'unverified' | 'admins';

/** Seconds since the last heartbeat that still count as online. */
export const ONLINE_SECONDS = 150;

const ACCOUNT_FILTERS: Record<AdminAccountFilter, string> = {
  all: 'true',
  online: `a.last_seen_at > now() - interval '${ONLINE_SECONDS} seconds'`,
  premium: 'a.paid_until > now()',
  unverified: 'NOT a.email_verified',
  admins: "a.role = 'admin'",
};

/**
 * Money received: paid card/UPI/PayPal orders and confirmed bank transfers,
 * with `refunded` set where the money went back.
 */
const PAID_ORDERS = `
  SELECT amount, currency, paid_at, refunded_at IS NOT NULL AS refunded
    FROM payments WHERE status = 'paid' AND paid_at IS NOT NULL`;
const PAID_REVENUE = `${PAID_ORDERS}
  UNION ALL
  SELECT amount, currency, reviewed_at AS paid_at, false AS refunded
    FROM bank_transfer_requests WHERE status = 'confirmed'`;

type NoticeRow = {
  id: string;
  kind: Notice['kind'];
  title: string;
  message: string;
  starts_at: Date | null;
  ends_at: Date | null;
  show_from: Date;
  show_until: Date | null;
  published: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

const toNotice = (row: NoticeRow): Notice => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  message: row.message,
  startsAt: row.starts_at ? iso(row.starts_at) : null,
  endsAt: row.ends_at ? iso(row.ends_at) : null,
  showFrom: iso(row.show_from),
  showUntil: row.show_until ? iso(row.show_until) : null,
  published: row.published,
  createdBy: row.created_by,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

/** Trend charts: hourly up to 2 days, 6-hourly up to a week, then daily. */
const bucketSeconds = (hours: number) =>
  hours <= 48 ? 3_600 : hours <= 168 ? 6 * 3_600 : 86_400;

type TrendRow = {
  at: Date;
  minutes: number;
  reports: number;
  poor: number;
  rtt_median: number | null;
  rtt_p95: number | null;
  frozen_ms: number;
  reconnects: number;
  background_reconnects: number;
  errors: number;
};

/**
 * One point per bucket across the whole window, including empty ones, so
 * every chart shares the same time axis. Our side / user side / unclear
 * counts come from the classified poor minutes.
 */
function buildTrend(
  hours: number,
  rows: TrendRow[],
  poor: { id: string; created_at: Date }[],
  sides: Map<string, { side: 'ours' | 'user' | 'unclear' }>,
) {
  const step = bucketSeconds(hours) * 1000;
  const end = Math.floor(Date.now() / step) * step;
  const start = Math.floor((Date.now() - hours * 3_600_000) / step) * step;
  const byTime = new Map(rows.map((row) => [row.at.getTime(), row]));
  const sideCounts = new Map<
    number,
    { ours: number; user: number; unclear: number }
  >();
  for (const minute of poor) {
    const key = Math.floor(minute.created_at.getTime() / step) * step;
    const counts = sideCounts.get(key) ?? { ours: 0, user: 0, unclear: 0 };
    counts[sides.get(minute.id)?.side ?? 'unclear']++;
    sideCounts.set(key, counts);
  }
  const points = [];
  for (let at = start; at <= end; at += step) {
    const row = byTime.get(at);
    const counts = sideCounts.get(at) ?? { ours: 0, user: 0, unclear: 0 };
    points.push({
      at: new Date(at).toISOString(),
      minutes: row?.minutes ?? 0,
      reports: row?.reports ?? 0,
      poor: row?.poor ?? 0,
      poorPercent:
        row && row.reports ? Math.round((row.poor / row.reports) * 100) : null,
      rttMedian: row?.rtt_median ?? null,
      rttP95: row?.rtt_p95 ?? null,
      frozenMs: row?.frozen_ms ?? 0,
      reconnects: row?.reconnects ?? 0,
      backgroundReconnects: row?.background_reconnects ?? 0,
      errors: row?.errors ?? 0,
      ...counts,
    });
  }
  return { bucketHours: step / 3_600_000, points };
}

/** Postgres's "undefined table": the database isn't migrated yet. */
const missingTable = (error: unknown) =>
  (error as { code?: string } | null)?.code === '42P01';

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
  ...(row.last_event ? { lastEvent: row.last_event } : {}),
  ...(row.last_event_at ? { lastEventAt: iso(row.last_event_at) } : {}),
  ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
  ...(row.expired_at ? { expiredAt: iso(row.expired_at) } : {}),
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

  async claimCheckoutReminders(
    olderThanHours: number,
    limit: number,
    youngerThanHours: number,
  ) {
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
            AND p.created_at > now() - make_interval(hours => $3)
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
      [olderThanHours, limit, youngerThanHours],
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

  /** Published notices whose display window is open now. */
  async listLiveNotices() {
    const { rows } = await this.pool
      .query<NoticeRow>(
        `SELECT * FROM notices
          WHERE published AND show_from <= now()
            AND (show_until IS NULL OR show_until > now())
          ORDER BY coalesce(starts_at, show_from)`,
      )
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '42P01') return { rows: [] };
        throw error;
      });
    return rows.map(toNotice);
  }

  /** Published notices from the last `days`, newest first, for /status. */
  async listRecentNotices(days: number) {
    const { rows } = await this.pool
      .query<NoticeRow>(
        `SELECT * FROM notices
          WHERE published AND show_from <= now()
            AND coalesce(show_until, now()) > now() - make_interval(days => $1)
          ORDER BY coalesce(starts_at, show_from) DESC
          LIMIT 50`,
        [days],
      )
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === '42P01') return { rows: [] };
        throw error;
      });
    return rows.map(toNotice);
  }

  async adminListNotices() {
    const { rows } = await this.pool.query<NoticeRow>(
      `SELECT * FROM notices ORDER BY created_at DESC LIMIT 100`,
    );
    return rows.map(toNotice);
  }

  async saveNotice(notice: Omit<Notice, 'createdAt' | 'updatedAt'>) {
    const { rows } = await this.pool.query<NoticeRow>(
      `INSERT INTO notices (id, kind, title, message, starts_at, ends_at,
                            show_from, show_until, published, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind, title = EXCLUDED.title,
         message = EXCLUDED.message, starts_at = EXCLUDED.starts_at,
         ends_at = EXCLUDED.ends_at, show_from = EXCLUDED.show_from,
         show_until = EXCLUDED.show_until, published = EXCLUDED.published,
         updated_at = now()
       RETURNING *`,
      [
        notice.id,
        notice.kind,
        notice.title,
        notice.message,
        notice.startsAt,
        notice.endsAt,
        notice.showFrom,
        notice.showUntil,
        notice.published,
        notice.createdBy,
      ],
    );
    return toNotice(rows[0]!);
  }

  async deleteNotice(id: string) {
    const { rowCount } = await this.pool.query(
      'DELETE FROM notices WHERE id = $1',
      [id],
    );
    return rowCount === 1;
  }

  async addQuickFeedback(entry: {
    id: string;
    userId: string;
    rating: number;
    tags: string[];
    features: string[];
    message?: string;
    context: Record<string, unknown>;
  }) {
    await this.pool.query(
      `INSERT INTO quick_feedback (id, user_id, rating, tags, features, message, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.id,
        entry.userId,
        entry.rating,
        entry.tags,
        entry.features,
        entry.message ?? null,
        JSON.stringify(entry.context),
      ],
    );
  }

  /** What people said, for the admin console's Feedback page. */
  async feedbackOverview(days: number) {
    const window = [days];
    const [totals, ratings, tags, features, recent, messages] =
      await Promise.all([
        this.pool.query(
          `SELECT count(*)::int AS answers,
                  count(DISTINCT user_id)::int AS people,
                  round(avg(rating)::numeric, 2)::float AS average,
                  count(*) FILTER (WHERE rating >= 4)::int AS happy,
                  count(*) FILTER (WHERE rating <= 2)::int AS unhappy
             FROM quick_feedback
            WHERE created_at > now() - make_interval(days => $1)`,
          window,
        ),
        this.pool.query(
          `SELECT rating, count(*)::int AS count FROM quick_feedback
            WHERE created_at > now() - make_interval(days => $1)
            GROUP BY rating`,
          window,
        ),
        this.pool.query(
          `SELECT tag, count(*)::int AS count,
                  round(avg(rating)::numeric, 1)::float AS average
             FROM quick_feedback, unnest(tags) AS tag
            WHERE created_at > now() - make_interval(days => $1)
            GROUP BY tag ORDER BY count DESC`,
          window,
        ),
        this.pool.query(
          `SELECT feature, count(*)::int AS count
             FROM quick_feedback, unnest(features) AS feature
            WHERE created_at > now() - make_interval(days => $1)
            GROUP BY feature ORDER BY count DESC`,
          window,
        ),
        this.pool.query(
          `SELECT q.id, q.created_at, q.rating, q.tags, q.features, q.message,
                  q.context, a.name, a.email
             FROM quick_feedback q LEFT JOIN accounts a ON a.id = q.user_id
            WHERE q.created_at > now() - make_interval(days => $1)
            ORDER BY q.created_at DESC LIMIT 60`,
          window,
        ),
        this.pool.query(
          `SELECT id, created_at, email, name, category, rating, message, page
             FROM feedback
            WHERE created_at > now() - make_interval(days => $1)
            ORDER BY created_at DESC LIMIT 30`,
          window,
        ),
      ]);
    const t = totals.rows[0]!;
    return {
      days,
      totals: {
        answers: t.answers,
        people: t.people,
        average: t.average,
        happy: t.happy,
        unhappy: t.unhappy,
      },
      ratings: [1, 2, 3, 4, 5].map((rating) => ({
        rating,
        count: ratings.rows.find((row) => row.rating === rating)?.count ?? 0,
      })),
      tags: tags.rows.map((row) => ({
        id: row.tag,
        count: row.count,
        average: row.average,
      })),
      features: features.rows.map((row) => ({
        id: row.feature,
        count: row.count,
      })),
      recent: recent.rows.map((row) => ({
        id: row.id,
        at: iso(row.created_at),
        rating: row.rating,
        tags: row.tags,
        features: row.features,
        message: row.message,
        context: row.context,
        name: row.name,
        email: row.email,
      })),
      messages: messages.rows.map((row) => ({
        id: row.id,
        at: iso(row.created_at),
        email: row.email,
        name: row.name,
        category: row.category,
        rating: row.rating,
        message: row.message,
        page: row.page,
      })),
    };
  }

  async addBoardMetric(row: BoardMetricRow) {
    await this.pool.query(
      `INSERT INTO board_metrics (
         id, user_id, guest, board_id, visible_ms,
         rtt_p50, rtt_p95, rtt_max, save_p50, save_p95, save_max, saves,
         reconnects, rejected, offline_ms, slow_frames, slow_frame_ms,
         worst_frame_ms, errors, first_error, objects, zoom, mobile, browser,
         os, cores, memory_gb, network, screen, country, poor, reasons,
         app_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
               $27, $28, $29, $30, $31, $32, $33)`,
      [
        row.id,
        row.userId,
        row.guest,
        row.boardId,
        row.visibleMs,
        row.rttP50,
        row.rttP95,
        row.rttMax,
        row.saveP50,
        row.saveP95,
        row.saveMax,
        row.saves,
        row.reconnects,
        row.rejected,
        row.offlineMs,
        row.slowFrames,
        row.slowFrameMs,
        row.worstFrameMs,
        row.errors,
        row.firstError,
        row.objects,
        row.zoom,
        row.mobile,
        row.browser,
        row.os,
        row.cores,
        row.memoryGb,
        row.network,
        row.screen,
        row.country,
        row.poor,
        row.reasons,
        row.appVersion,
      ],
    );
  }

  /** Notes a build the first time it is seen; the earliest time is kept. */
  async noteAppVersion(version: string, message?: string) {
    await this.pool.query(
      `INSERT INTO app_versions (version, message) VALUES ($1, $2)
       ON CONFLICT (version) DO UPDATE
         SET message = coalesce(app_versions.message, EXCLUDED.message)`,
      [version, message?.slice(0, 200) ?? null],
    );
  }

  async purgeBoardMetrics(days: number) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM board_metrics
        WHERE created_at < now() - make_interval(days => $1)`,
      [days],
    );
    return rowCount ?? 0;
  }

  /** How boards performed over the last `hours`, for the admin console. */
  async performanceOverview(hours: number, version: string | null = null) {
    // "latest" means the most recently released build.
    const onlyVersion =
      version === 'latest'
        ? ((
            await this.pool
              .query<{ version: string }>(
                'SELECT version FROM app_versions ORDER BY first_seen_at DESC LIMIT 1',
              )
              .catch(() => ({ rows: [] as { version: string }[] }))
          ).rows[0]?.version ?? null)
        : version;
    // Every query takes the time window ($1) and, optionally, one version ($2).
    const window = [hours, onlyVersion];
    const versionIs = `($2::text IS NULL OR app_version = $2)`;
    // Minutes when nobody had the board on screen (a background tab, a
    // sleeping computer) aren't felt, so they don't count towards anything
    // but the separate background-reconnect figure.
    const onScreen = `${versionIs} AND visible_ms > 0`;
    const [
      totals,
      devices,
      countries,
      worst,
      errors,
      hourly,
      poorAll,
      versions,
      background,
      trend,
    ] = await Promise.all([
      this.pool.query(
        `SELECT count(*)::int AS reports,
                  count(DISTINCT user_id)::int AS people,
                  count(DISTINCT board_id)::int AS boards,
                  count(*) FILTER (WHERE poor)::int AS poor,
                  round(sum(visible_ms) / 60000.0)::int AS minutes,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY rtt_p50)::int AS rtt_median,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY rtt_p95)::int AS rtt_p95,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY save_p95)::int AS save_p95,
                  coalesce(sum(slow_frames), 0)::int AS slow_frames,
                  coalesce(sum(reconnects), 0)::int AS reconnects,
                  coalesce(sum(errors), 0)::int AS errors
             FROM board_metrics
            WHERE created_at > now() - make_interval(hours => $1) AND ${onScreen}`,
        window,
      ),
      this.pool.query(
        `SELECT os, browser, mobile, count(*)::int AS reports,
                  count(DISTINCT user_id)::int AS people,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY rtt_p50)::int AS rtt_median,
                  round(avg(slow_frame_ms))::int AS freeze_ms_per_min,
                  round(100.0 * count(*) FILTER (WHERE poor) / count(*))::int AS poor_percent
             FROM board_metrics
            WHERE created_at > now() - make_interval(hours => $1) AND ${onScreen}
            GROUP BY os, browser, mobile
            ORDER BY reports DESC
            LIMIT 12`,
        window,
      ),
      this.pool.query(
        `SELECT coalesce(country, '??') AS country, count(*)::int AS reports,
                  count(DISTINCT user_id)::int AS people,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY rtt_p50)::int AS rtt_median,
                  round(100.0 * count(*) FILTER (WHERE poor) / count(*))::int AS poor_percent
             FROM board_metrics
            WHERE created_at > now() - make_interval(hours => $1) AND ${onScreen}
            GROUP BY 1
            ORDER BY reports DESC
            LIMIT 12`,
        window,
      ),
      this.pool.query(
        `SELECT m.id, m.created_at, m.user_id, m.guest, m.board_id,
                  m.rtt_p95, m.save_p95, m.slow_frame_ms, m.worst_frame_ms,
                  m.reconnects, m.offline_ms, m.errors, m.first_error,
                  m.objects, m.zoom, m.mobile, m.browser, m.os, m.cores,
                  m.memory_gb, m.network, m.country, m.reasons,
                  a.name, a.email, b.title
             FROM board_metrics m
             LEFT JOIN accounts a ON a.id = m.user_id
             LEFT JOIN boards b ON b.id = m.board_id
            WHERE m.poor AND m.visible_ms > 0
              AND m.created_at > now() - make_interval(hours => $1)
              AND ($2::text IS NULL OR m.app_version = $2)
            ORDER BY m.created_at DESC
            LIMIT 40`,
        window,
      ),
      this.pool.query(
        `SELECT first_error AS message, count(*)::int AS reports,
                  count(DISTINCT user_id)::int AS people, max(created_at) AS last_seen
             FROM board_metrics
            WHERE first_error IS NOT NULL
              AND created_at > now() - make_interval(hours => $1) AND ${versionIs}
            GROUP BY first_error
            ORDER BY reports DESC
            LIMIT 10`,
        window,
      ),
      this.pool.query(
        `SELECT date_trunc('hour', created_at) AS hour, count(*)::int AS reports,
                  count(*) FILTER (WHERE poor)::int AS poor,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY rtt_p50)::int AS rtt_median
             FROM board_metrics
            WHERE created_at > now() - make_interval(hours => $1) AND ${onScreen}
            GROUP BY 1
            ORDER BY 1`,
        window,
      ),
      this.pool.query(
        `SELECT id, created_at, user_id, rtt_p95, save_p95, reconnects,
                  offline_ms, slow_frame_ms, worst_frame_ms, errors, rejected,
                  objects, mobile, cores, memory_gb
             FROM board_metrics
            WHERE poor AND created_at > now() - make_interval(hours => $1)
              AND ${onScreen}
            ORDER BY created_at
            LIMIT 3000`,
        window,
      ),
      this.pool
        .query(
          `SELECT v.version, v.first_seen_at, v.message,
                    count(m.id)::int AS reports,
                    count(m.id) FILTER (WHERE m.poor)::int AS poor
               FROM app_versions v
               LEFT JOIN board_metrics m
                 ON m.app_version = v.version
                AND m.created_at > now() - make_interval(hours => $1)
                AND m.visible_ms > 0
              GROUP BY v.version, v.first_seen_at, v.message
             HAVING v.first_seen_at > now() - make_interval(hours => $1)
                 OR count(m.id) > 0
              ORDER BY v.first_seen_at DESC
              LIMIT 20`,
          [hours],
        )
        .catch((error: unknown) => {
          // Not migrated yet: no versions to show.
          if ((error as { code?: string }).code === '42P01')
            return { rows: [] };
          throw error;
        }),
      this.pool.query<{ minutes: number; reconnects: number; people: number }>(
        `SELECT count(*)::int AS minutes,
                coalesce(sum(reconnects), 0)::int AS reconnects,
                count(DISTINCT user_id)::int AS people
           FROM board_metrics
          WHERE visible_ms = 0
            AND created_at > now() - make_interval(hours => $1)
            AND ${versionIs}`,
        window,
      ),
      this.pool.query(
        `SELECT date_bin(make_interval(secs => $3), created_at,
                         timestamptz '1970-01-01 00:00:00+00') AS at,
                round(coalesce(sum(visible_ms) FILTER (WHERE visible_ms > 0), 0)
                      / 60000.0)::int AS minutes,
                count(*) FILTER (WHERE visible_ms > 0)::int AS reports,
                count(*) FILTER (WHERE poor AND visible_ms > 0)::int AS poor,
                (percentile_cont(0.5) WITHIN GROUP (ORDER BY rtt_p50)
                   FILTER (WHERE visible_ms > 0))::int AS rtt_median,
                (percentile_cont(0.95) WITHIN GROUP (ORDER BY rtt_p95)
                   FILTER (WHERE visible_ms > 0))::int AS rtt_p95,
                coalesce(sum(slow_frame_ms) FILTER (WHERE visible_ms > 0), 0)::int
                  AS frozen_ms,
                coalesce(sum(reconnects) FILTER (WHERE visible_ms > 0), 0)::int
                  AS reconnects,
                coalesce(sum(reconnects) FILTER (WHERE visible_ms = 0), 0)::int
                  AS background_reconnects,
                coalesce(sum(errors), 0)::int AS errors
           FROM board_metrics
          WHERE created_at > now() - make_interval(hours => $1)
            AND ${versionIs}
          GROUP BY 1
          ORDER BY 1`,
        [hours, onlyVersion, bucketSeconds(hours)],
      ),
    ]);
    const releases = versions.rows.map((row) => row.first_seen_at.getTime());
    const sides = classifyPoor(
      poorAll.rows.map((row) => ({
        id: row.id,
        at: row.created_at.getTime(),
        userId: row.user_id,
        rttP95: row.rtt_p95,
        saveP95: row.save_p95,
        reconnects: row.reconnects,
        offlineMs: row.offline_ms,
        slowFrameMs: row.slow_frame_ms,
        worstFrameMs: row.worst_frame_ms,
        errors: row.errors,
        rejected: row.rejected,
        objects: row.objects,
        mobile: row.mobile,
        cores: row.cores,
        memoryGb: row.memory_gb,
      })),
      releases,
    );
    const sideCount = { ours: 0, user: 0, unclear: 0 };
    for (const { side } of sides.values()) sideCount[side]++;
    const t = totals.rows[0]!;
    return {
      hours,
      totals: {
        reports: t.reports,
        people: t.people,
        boards: t.boards,
        poor: t.poor,
        minutes: t.minutes ?? 0,
        rttMedian: t.rtt_median,
        rttP95: t.rtt_p95,
        saveP95: t.save_p95,
        slowFrames: t.slow_frames,
        reconnects: t.reconnects,
        errors: t.errors,
      },
      devices: devices.rows.map((row) => ({
        os: row.os,
        browser: row.browser,
        mobile: row.mobile,
        reports: row.reports,
        people: row.people,
        rttMedian: row.rtt_median,
        freezeMsPerMin: row.freeze_ms_per_min,
        poorPercent: row.poor_percent,
      })),
      countries: countries.rows.map((row) => ({
        country: row.country,
        reports: row.reports,
        people: row.people,
        rttMedian: row.rtt_median,
        poorPercent: row.poor_percent,
      })),
      worst: worst.rows.map((row) => ({
        id: row.id,
        at: iso(row.created_at),
        userId: row.user_id,
        guest: row.guest,
        name: row.name,
        email: row.email,
        boardId: row.board_id,
        boardTitle: row.title,
        rttP95: row.rtt_p95,
        saveP95: row.save_p95,
        slowFrameMs: row.slow_frame_ms,
        worstFrameMs: row.worst_frame_ms,
        reconnects: row.reconnects,
        offlineMs: row.offline_ms,
        errors: row.errors,
        firstError: row.first_error,
        objects: row.objects,
        zoom: row.zoom,
        mobile: row.mobile,
        browser: row.browser,
        os: row.os,
        cores: row.cores,
        memoryGb: row.memory_gb,
        network: row.network,
        country: row.country,
        reasons: row.reasons,
        side: sides.get(row.id)?.side ?? 'unclear',
        why: sides.get(row.id)?.why ?? [],
      })),
      errors: errors.rows.map((row) => ({
        message: row.message,
        reports: row.reports,
        people: row.people,
        lastSeen: iso(row.last_seen),
      })),
      sides: sideCount,
      background: background.rows[0] ?? {
        minutes: 0,
        reconnects: 0,
        people: 0,
      },
      versions: versions.rows.map((row) => ({
        version: row.version,
        firstSeen: iso(row.first_seen_at),
        message: row.message,
        reports: row.reports,
        poor: row.poor,
      })),
      onlyVersion,
      trend: buildTrend(hours, trend.rows, poorAll.rows, sides),
      hourly: hourly.rows.map((row) => ({
        hour: iso(row.hour),
        reports: row.reports,
        poor: row.poor,
        rttMedian: row.rtt_median,
      })),
    };
  }

  async noteOrderEvent(orderId: string, event: string, failureReason?: string) {
    try {
      await this.pool.query(
        `UPDATE payments
            SET last_event = $2, last_event_at = now(),
                failure_reason = coalesce($3, failure_reason)
          WHERE order_id = $1`,
        [orderId, event, failureReason?.slice(0, 500) ?? null],
      );
    } catch (error) {
      // Before the migration there's nowhere to keep it; the log line has it.
      if (!missingColumn(error)) throw error;
    }
  }

  async listStaleOrders(olderThanHours: number, limit: number) {
    const { rows } = await this.pool.query<PaymentRow>(
      `SELECT * FROM payments
        WHERE status = 'created'
          AND created_at <= now() - make_interval(hours => $1)
        ORDER BY created_at
        LIMIT $2`,
      [olderThanHours, limit],
    );
    return rows.map(toPayment);
  }

  async expireOrder(orderId: string, reason: string) {
    const { rowCount } = await this.pool.query(
      `UPDATE payments
          SET status = 'expired', expired_at = now(), failure_reason = $2
        WHERE order_id = $1 AND status = 'created'`,
      [orderId, reason],
    );
    return rowCount === 1;
  }

  async purgeExpiredOrders(days: number) {
    // An order with a recorded capture is a money record; it is never deleted.
    const { rowCount } = await this.pool.query(
      `DELETE FROM payments p
        WHERE p.status = 'expired'
          AND p.expired_at <= now() - make_interval(days => $1)
          AND NOT EXISTS (
            SELECT 1 FROM payment_captures c WHERE c.order_id = p.order_id)`,
      [days],
    );
    return rowCount ?? 0;
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

  async listAdminAccounts(
    search: string,
    limit: number,
    offset: number,
    filter: AdminAccountFilter = 'all',
  ) {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.email, a.role, a.email_verified, a.name, a.created_at,
              a.last_seen_at, a.trial_used_seconds, a.paid_until,
              coalesce(a.last_seen_at > now() - interval '${ONLINE_SECONDS} seconds', false) AS online,
              (SELECT count(*)::int FROM boards b WHERE b.owner_id = a.id) AS board_count,
              (SELECT count(*)::int FROM payments p WHERE p.user_id = a.id) AS payment_count,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'provider', recent.provider, 'status', recent.status,
                 'plan', recent.plan, 'months', recent.months, 'days', recent.days,
                 'amount', recent.amount, 'currency', recent.currency,
                 'createdAt', recent.created_at, 'paidAt', recent.paid_at,
                 'refundedAt', recent.refunded_at, 'orderId', recent.order_id,
                 'lastEvent', recent.last_event, 'failureReason', recent.failure_reason,
                 'expiredAt', recent.expired_at
               ) ORDER BY recent.created_at DESC), '[]'::jsonb)
                 FROM (SELECT provider, status, plan, months, days, amount, currency,
                              created_at, paid_at, refunded_at, order_id,
                              last_event, failure_reason, expired_at
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
        WHERE ($1 = '' OR a.id ILIKE '%' || $1 || '%'
           OR a.email ILIKE '%' || $1 || '%' OR a.name ILIKE '%' || $1 || '%')
          AND ${ACCOUNT_FILTERS[filter]}
        ORDER BY ${filter === 'online' ? 'a.last_seen_at DESC,' : ''} a.created_at DESC, a.id
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
        online: row.online,
        boardCount: row.board_count,
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

  async logAdminAction(action: {
    id: string;
    username: string;
    action: string;
    userId?: string;
    detail?: Record<string, unknown>;
  }) {
    await this.pool.query(
      `INSERT INTO admin_actions (id, admin_username, action, user_id, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        action.id,
        action.username,
        action.action,
        action.userId ?? null,
        JSON.stringify(action.detail ?? {}),
      ],
    );
  }

  async listAdminActions(limit: number) {
    const { rows } = await this.pool
      .query<{
        id: string;
        admin_username: string;
        action: string;
        user_id: string | null;
        detail: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT id, admin_username, action, user_id, detail, created_at
         FROM admin_actions ORDER BY created_at DESC LIMIT $1`,
        [limit],
      )
      .catch((error: unknown) => {
        if (missingTable(error)) return { rows: [] };
        throw error;
      });
    return rows.map((row) => ({
      id: row.id,
      adminUsername: row.admin_username,
      action: row.action,
      userId: row.user_id,
      detail: row.detail,
      createdAt: iso(row.created_at),
    }));
  }

  /** Admin-set prices, or nothing for a currency left at the defaults. */
  async getPlanPrices() {
    try {
      const { rows } = await this.pool.query<{
        currency: Currency;
        plan: PlanId;
        amount: number;
      }>('SELECT currency, plan, amount FROM plan_prices');
      const prices: Partial<Record<Currency, PriceSet>> = {};
      for (const currency of CURRENCIES) {
        const amounts = PLAN_IDS.map(
          (id) =>
            rows.find((row) => row.currency === currency && row.plan === id)
              ?.amount,
        );
        if (amounts.every((amount) => amount !== undefined))
          prices[currency] = amounts as unknown as PriceSet;
      }
      return prices;
    } catch (error) {
      // Not migrated yet: the prices in code apply.
      if ((error as { code?: string }).code === '42P01') return {};
      throw error;
    }
  }

  async setPlanPrices(
    currency: Currency,
    prices: PriceSet | null,
    username: string,
  ) {
    await this.transaction(async (client) => {
      await client.query('DELETE FROM plan_prices WHERE currency = $1', [
        currency,
      ]);
      if (prices)
        for (const [index, id] of PLAN_IDS.entries())
          await client.query(
            `INSERT INTO plan_prices (currency, plan, amount, updated_by)
             VALUES ($1, $2, $3, $4)`,
            [currency, id, prices[index], username],
          );
    });
  }

  /** Counts and money for the console's overview. */
  async adminOverview(onlineSeconds: number) {
    try {
      return await this.overviewFrom(onlineSeconds, PAID_REVENUE);
    } catch (error) {
      // Bank transfers aren't migrated yet: count card and PayPal money only.
      if (!missingTable(error)) throw error;
      return this.overviewFrom(onlineSeconds, PAID_ORDERS);
    }
  }

  private async overviewFrom(onlineSeconds: number, paidRevenue: string) {
    const [accounts, revenue, daily, plans] = await Promise.all([
      this.pool.query<{
        total: number;
        verified: number;
        premium: number;
        online: number;
        active_day: number;
        new_week: number;
        admins: number;
      }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE email_verified)::int AS verified,
                count(*) FILTER (WHERE paid_until > now())::int AS premium,
                count(*) FILTER (WHERE last_seen_at > now() - make_interval(secs => $1))::int AS online,
                count(*) FILTER (WHERE last_seen_at > now() - interval '1 day')::int AS active_day,
                count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_week,
                count(*) FILTER (WHERE role = 'admin')::int AS admins
           FROM accounts`,
        [onlineSeconds],
      ),
      this.pool.query<{
        currency: string;
        total: string;
        month: string;
        last30: string;
        today: string;
        orders: number;
        refunded: number;
      }>(
        `WITH paid AS (${paidRevenue})
         SELECT currency,
                sum(amount) FILTER (WHERE NOT refunded)::bigint AS total,
                coalesce(sum(amount) FILTER (WHERE NOT refunded AND paid_at >= date_trunc('month', now())), 0)::bigint AS month,
                coalesce(sum(amount) FILTER (WHERE NOT refunded AND paid_at > now() - interval '30 days'), 0)::bigint AS last30,
                coalesce(sum(amount) FILTER (WHERE NOT refunded AND paid_at >= date_trunc('day', now())), 0)::bigint AS today,
                count(*) FILTER (WHERE NOT refunded)::int AS orders,
                count(*) FILTER (WHERE refunded)::int AS refunded
           FROM paid GROUP BY currency ORDER BY currency`,
      ),
      this.pool.query<{ day: Date; currency: string; amount: string }>(
        `WITH paid AS (${paidRevenue})
         SELECT date_trunc('day', paid_at) AS day, currency, sum(amount)::bigint AS amount
           FROM paid
          WHERE NOT refunded AND paid_at > now() - interval '30 days'
          GROUP BY 1, 2 ORDER BY 1`,
      ),
      this.pool.query<{ plan: string | null; count: number }>(
        `SELECT plan, count(*)::int AS count FROM payments
          WHERE status = 'paid' AND refunded_at IS NULL GROUP BY plan`,
      ),
    ]);
    const row = accounts.rows[0]!;
    return {
      accounts: {
        total: row.total,
        verified: row.verified,
        premium: row.premium,
        online: row.online,
        activeDay: row.active_day,
        newWeek: row.new_week,
        admins: row.admins,
      },
      revenue: revenue.rows.map((item) => ({
        currency: item.currency,
        total: Number(item.total ?? 0),
        month: Number(item.month),
        last30: Number(item.last30),
        today: Number(item.today),
        orders: item.orders,
        refunded: item.refunded,
      })),
      daily: daily.rows.map((item) => ({
        day: iso(item.day).slice(0, 10),
        currency: item.currency,
        amount: Number(item.amount),
      })),
      plans: plans.rows.map((item) => ({
        plan: item.plan ?? 'legacy',
        count: item.count,
      })),
    };
  }

  /** Marks an address confirmed, as if its owner had entered the code. */
  async adminVerifyEmail(userId: string) {
    const { rowCount } = await this.pool.query(
      'UPDATE accounts SET email_verified = true WHERE id = $1',
      [userId],
    );
    await this.pool.query(
      'DELETE FROM email_verification_tokens WHERE user_id = $1',
      [userId],
    );
    return rowCount === 1;
  }

  /**
   * Marks an address unconfirmed again. Its owner can ask for a fresh code
   * on the verify-email page; until then upgrading is blocked as for any
   * unverified account.
   */
  async adminUnverifyEmail(userId: string) {
    const { rowCount } = await this.pool.query(
      'UPDATE accounts SET email_verified = false WHERE id = $1',
      [userId],
    );
    return rowCount === 1;
  }

  /** Ends Premium now; returns the end date it had, or undefined if none. */
  async adminRevokePremium(userId: string) {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ paid_until: Date | null }>(
        'SELECT paid_until FROM accounts WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!rows[0]) return { found: false as const };
      await client.query(
        `UPDATE accounts SET paid_until = NULL, premium_reminded_for = NULL
          WHERE id = $1`,
        [userId],
      );
      return {
        found: true as const,
        previous: rows[0].paid_until ? iso(rows[0].paid_until) : undefined,
      };
    });
  }

  /**
   * Removes an account: its sessions, codes, library, memberships and the
   * boards it owns (with everything on them). Payment records and the admin
   * audit trail stay, as the business's own records.
   */
  async adminDeleteAccount(userId: string) {
    const deleted = await this.transaction(async (client) => {
      const account = await client.query<{ email: string; name: string }>(
        'SELECT email, name FROM accounts WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!account.rows[0]) return undefined;
      const owned = await client.query<{ id: string }>(
        'DELETE FROM boards WHERE owner_id = $1 RETURNING id',
        [userId],
      );
      await client.query('DELETE FROM board_members WHERE user_id = $1', [
        userId,
      ]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM reset_tokens WHERE user_id = $1', [
        userId,
      ]);
      await client.query('DELETE FROM account_library WHERE account_id = $1', [
        userId,
      ]);
      await client.query(
        'DELETE FROM bank_transfer_requests WHERE user_id = $1',
        [userId],
      );
      await client.query('DELETE FROM accounts WHERE id = $1', [userId]);
      return { ...account.rows[0], boards: owned.rows.map((row) => row.id) };
    });
    if (deleted)
      for (const boardId of deleted.boards)
        for (const presence of await this.live.listPresence(boardId))
          await this.live.removePresence(boardId, presence.peerId);
    return deleted;
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
