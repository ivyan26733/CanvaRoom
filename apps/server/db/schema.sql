-- CanvaRoom schema. Safe to run repeatedly: `npm run db:migrate -w @collabboard/server`.
-- Presence, rate limits, and cross-instance relaying live in Redis, not here.

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  color text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);

-- Admin access is granted per registered account, not by email alone.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'accounts_role_check'
       AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_role_check
      CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

-- Pre-existing accounts stay usable; new accounts default to unverified.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'accounts'
       AND column_name = 'email_verified'
  ) THEN
    ALTER TABLE accounts ADD COLUMN email_verified boolean NOT NULL DEFAULT true;
  END IF;
END $$;
ALTER TABLE accounts ALTER COLUMN email_verified SET DEFAULT false;

-- Keyed by a hash of the cookie token. Guests have a session but no account.
CREATE TABLE IF NOT EXISTS sessions (
  key text PRIMARY KEY,
  user_id text NOT NULL,
  guest jsonb,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- One live reset link per user; requesting another replaces it.
CREATE TABLE IF NOT EXISTS reset_tokens (
  key text PRIMARY KEY,
  user_id text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL
);

-- One live sign-up code per account, stored only as a SHA-256 hash.
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  key text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS email_verification_tokens_expiry_idx ON email_verification_tokens (expires_at);

CREATE TABLE IF NOT EXISTS boards (
  id text PRIMARY KEY,
  title text NOT NULL,
  owner_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  locked boolean NOT NULL DEFAULT false,
  invite_token text NOT NULL,
  invite_revoked boolean NOT NULL DEFAULT false,
  pages jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS board_members (
  board_id text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  name text NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_members_user_id_idx ON board_members (user_id);

-- One row per object so concurrent edits to different objects never collide.
-- `seq` keeps stacking order: objects are drawn in the order they were added.
CREATE TABLE IF NOT EXISTS board_objects (
  board_id text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  id text NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  data jsonb NOT NULL,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX IF NOT EXISTS board_objects_order_idx ON board_objects (board_id, seq);

-- Deleted object IDs, so a late edit from a slow client cannot bring one back.
CREATE TABLE IF NOT EXISTS board_tombstones (
  board_id text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  id text NOT NULL,
  PRIMARY KEY (board_id, id)
);

CREATE TABLE IF NOT EXISTS board_messages (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS board_messages_board_idx ON board_messages (board_id, seq);

CREATE TABLE IF NOT EXISTS board_snapshots (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS board_snapshots_board_idx ON board_snapshots (board_id, seq);

-- Free trial and paid pass. Accounts that existed before trials get a fresh
-- 30-minute trial from the first migration; new accounts set it on sign-up.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS paid_until timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
UPDATE accounts SET trial_ends_at = now() + interval '30 minutes'
 WHERE trial_ends_at IS NULL;

-- The trial counts active use, not wall-clock time: seconds used so far, and
-- when time was last counted (a later count after a long gap adds nothing).
-- Accounts from the wall-clock trial keep what it had left; expired ones stay
-- expired. trial_ends_at is no longer read once this has run.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trial_used_seconds double precision;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trial_beat_at timestamptz;
UPDATE accounts
   SET trial_used_seconds = least(1800, greatest(0,
         1800 - extract(epoch FROM (
           coalesce(trial_ends_at, created_at + interval '30 minutes') - now()))))
 WHERE trial_used_seconds IS NULL;
ALTER TABLE accounts ALTER COLUMN trial_used_seconds SET DEFAULT 0;
ALTER TABLE accounts ALTER COLUMN trial_used_seconds SET NOT NULL;

-- Razorpay orders created for a user, and whether each was paid.
CREATE TABLE IF NOT EXISTS payments (
  order_id text PRIMARY KEY,
  user_id text NOT NULL,
  amount integer NOT NULL CHECK (amount >= 100),
  currency text NOT NULL,
  status text NOT NULL CHECK (status IN ('created', 'paid')),
  payment_id text UNIQUE,
  created_at timestamptz NOT NULL,
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments (user_id);
-- Finds a user's recent unpaid order, so opening checkout twice reuses it.
CREATE INDEX IF NOT EXISTS payments_open_idx
  ON payments (user_id, created_at DESC) WHERE status = 'created';

-- Every captured payment we have seen, from checkout, the webhook or a
-- reconcile, once per payment. `applied` is false for an extra payment on an
-- order that was already paid: those need refunding.
CREATE TABLE IF NOT EXISTS payment_captures (
  payment_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES payments (order_id),
  user_id text NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL,
  source text NOT NULL CHECK (source IN ('checkout', 'webhook', 'reconcile')),
  applied boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_captures_order_idx ON payment_captures (order_id);

-- The 3, 6 and 12-month plans: which plan an order is for, and the calendar
-- months and extra days it adds. Empty on one-month orders from before them.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS months integer CHECK (months >= 0);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS days integer CHECK (days >= 0);

-- PayPal Checkout beside Razorpay: which provider took each order (older
-- rows are Razorpay's), and when a full refund took its Premium time back.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'razorpay';
-- PayPal orders taken before this column existed: Razorpay's IDs start order_.
UPDATE payments SET provider = 'paypal'
 WHERE provider = 'razorpay' AND order_id NOT LIKE 'order\_%';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
-- Track checkout recovery emails. Claims expire so a crashed cron can retry.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_reminder_claimed_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_reminded_at timestamptz;
CREATE INDEX IF NOT EXISTS payments_checkout_reminder_due_idx
  ON payments (created_at)
  WHERE status = 'created' AND checkout_reminded_at IS NULL;

-- Where each checkout stopped, for debugging: the latest step (like
-- client.dismissed), why it failed, and when an unpaid order expired. Unpaid
-- orders become 'expired' after two days; a late payment still applies.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_event text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_event_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS expired_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payments_status_check'
       AND conrelid = 'payments'::regclass
       AND pg_get_constraintdef(oid) LIKE '%expired%'
  ) THEN
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
    ALTER TABLE payments ADD CONSTRAINT payments_status_check
      CHECK (status IN ('created', 'paid', 'expired'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS payments_stale_idx
  ON payments (created_at) WHERE status = 'created';

-- The Premium end date a renewal reminder was sent for. Paying again moves
-- paid_until, so the new end date gets its own reminder.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS premium_reminded_for timestamptz;
CREATE INDEX IF NOT EXISTS accounts_paid_until_idx
  ON accounts (paid_until) WHERE paid_until IS NOT NULL;

-- Admin credentials live in deployment secrets. These tables hold only
-- opaque admin sessions and the audit trail for offline Premium grants.
CREATE TABLE IF NOT EXISTS admin_sessions (
  key text PRIMARY KEY,
  username text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS admin_access_grants (
  id text PRIMARY KEY,
  admin_username text NOT NULL,
  user_id text NOT NULL,
  months integer NOT NULL CHECK (months >= 0),
  days integer NOT NULL CHECK (days >= 0),
  method text NOT NULL,
  reference text,
  note text,
  previous_paid_until timestamptz,
  paid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (months > 0 OR days > 0)
);
CREATE INDEX IF NOT EXISTS admin_access_grants_user_idx
  ON admin_access_grants (user_id, created_at DESC);

-- USD bank transfers are reviewed manually. Premium stays locked until an
-- admin confirms receipt; the reference lets the incoming transfer be matched.
CREATE TABLE IF NOT EXISTS bank_transfer_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES accounts (id),
  plan text NOT NULL,
  amount integer NOT NULL CHECK (amount >= 100),
  currency text NOT NULL CHECK (currency = 'USD'),
  months integer NOT NULL CHECK (months >= 0),
  days integer NOT NULL CHECK (days >= 0),
  reference text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('instructions', 'pending', 'confirmed', 'rejected')),
  sender_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  paid_until timestamptz,
  CHECK (months > 0 OR days > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_transfer_open_user_plan_idx
  ON bank_transfer_requests (user_id, plan)
  WHERE status IN ('instructions', 'pending');
CREATE INDEX IF NOT EXISTS bank_transfer_pending_idx
  ON bank_transfer_requests (created_at)
  WHERE status = 'pending';

-- Premium prices an admin set in the console. Without a row the prices in
-- code (apps/server/src/plans.ts) apply.
CREATE TABLE IF NOT EXISTS plan_prices (
  currency text NOT NULL CHECK (currency IN ('USD', 'INR')),
  plan text NOT NULL CHECK (plan IN ('quarterly', 'half-year', 'yearly')),
  amount integer NOT NULL CHECK (amount >= 100),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, plan)
);

-- Everything an admin changed by hand: verifying, revoking, adding and
-- removing accounts, and repricing. Premium grants keep their own table.
CREATE TABLE IF NOT EXISTS admin_actions (
  id text PRIMARY KEY,
  admin_username text NOT NULL,
  action text NOT NULL,
  user_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_actions_created_idx ON admin_actions (created_at DESC);

-- Who is online: the console lists accounts seen in the last few minutes.
CREATE INDEX IF NOT EXISTS accounts_last_seen_idx
  ON accounts (last_seen_at DESC) WHERE last_seen_at IS NOT NULL;

-- How boards perform for people: one row per open board per minute, sent by
-- the browser (apps/web/app/lib/board-metrics.ts). Numbers about the session
-- only, never board content. Kept 30 days; the daily cron deletes older rows.
CREATE TABLE IF NOT EXISTS board_metrics (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text NOT NULL,
  guest boolean NOT NULL DEFAULT false,
  board_id text NOT NULL,
  visible_ms integer NOT NULL,
  rtt_p50 integer,
  rtt_p95 integer,
  rtt_max integer,
  save_p50 integer,
  save_p95 integer,
  save_max integer,
  saves integer NOT NULL DEFAULT 0,
  reconnects integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  offline_ms integer NOT NULL DEFAULT 0,
  slow_frames integer NOT NULL DEFAULT 0,
  slow_frame_ms integer NOT NULL DEFAULT 0,
  worst_frame_ms integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  first_error text,
  objects integer NOT NULL DEFAULT 0,
  zoom real,
  mobile boolean NOT NULL DEFAULT false,
  browser text,
  os text,
  cores integer,
  memory_gb real,
  network text,
  screen text,
  country text,
  poor boolean NOT NULL DEFAULT false,
  reasons text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS board_metrics_created_idx ON board_metrics (created_at DESC);
CREATE INDEX IF NOT EXISTS board_metrics_poor_idx
  ON board_metrics (created_at DESC) WHERE poor;

-- Answers from the in-app feedback prompt: a star rating, the one-tap
-- answers picked (tags: problems or praise; features: what to add), optional
-- words, and how the board was running at the time.
CREATE TABLE IF NOT EXISTS quick_feedback (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags text[] NOT NULL DEFAULT '{}',
  features text[] NOT NULL DEFAULT '{}',
  message text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS quick_feedback_created_idx ON quick_feedback (created_at DESC);

-- The free plan keeps an owner's oldest board, found through this index.
CREATE INDEX IF NOT EXISTS boards_owner_created_idx ON boards (owner_id, created_at);

-- Feedback sent from the site. Mailed to the team when email is set up.
CREATE TABLE IF NOT EXISTS feedback (
  id text PRIMARY KEY,
  user_id text,
  email text NOT NULL,
  name text,
  category text NOT NULL,
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  message text NOT NULL,
  page text,
  created_at timestamptz NOT NULL,
  mailed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at);

-- Library packs each account has installed, so they follow it across devices.
CREATE TABLE IF NOT EXISTS account_library (
  account_id text NOT NULL,
  pack_id text NOT NULL,
  installed_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, pack_id)
);
