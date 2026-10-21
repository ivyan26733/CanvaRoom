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
