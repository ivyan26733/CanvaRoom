-- Additive migration for the in-app feedback prompt. Also in schema.sql.
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

