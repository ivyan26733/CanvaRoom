-- Additive migration for site-wide notices. Also in schema.sql.
-- Notices for everyone (maintenance, downtime, repairs, news), written in
-- the admin console. Shown as a banner while between show_from and
-- show_until; starts_at/ends_at describe the event itself, if it has a time.
CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('maintenance', 'outage', 'info', 'update')),
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  starts_at timestamptz,
  ends_at timestamptz,
  show_from timestamptz NOT NULL DEFAULT now(),
  show_until timestamptz,
  published boolean NOT NULL DEFAULT false,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notices_live_idx
  ON notices (show_from) WHERE published;

