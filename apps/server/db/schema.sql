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
