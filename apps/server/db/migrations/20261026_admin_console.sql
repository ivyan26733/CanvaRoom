-- Additive migration for the admin console: stored prices, the audit log of
-- admin actions, and the index behind the online list. Also in schema.sql.
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

