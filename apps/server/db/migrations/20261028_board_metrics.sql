-- Additive migration for board performance reports. Also in schema.sql.
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

