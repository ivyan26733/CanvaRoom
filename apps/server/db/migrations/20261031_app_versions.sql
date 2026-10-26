-- Additive migration: app version on performance reports. Also in schema.sql.
-- Which build of the app sent each performance report, and when each build
-- was first seen, so the admin console can show "since the last update".
ALTER TABLE board_metrics ADD COLUMN IF NOT EXISTS app_version text;
CREATE TABLE IF NOT EXISTS app_versions (
  version text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  message text
);

