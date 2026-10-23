-- Additive migration for payment checkout reminder tracking.
-- This is deliberately separate from schema.sql, whose legacy trial
-- backfill should not be rerun just to enable checkout reminders.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS checkout_reminder_claimed_at timestamptz;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS checkout_reminded_at timestamptz;

CREATE INDEX IF NOT EXISTS payments_checkout_reminder_due_idx
  ON payments (created_at)
  WHERE status = 'created' AND checkout_reminded_at IS NULL;
