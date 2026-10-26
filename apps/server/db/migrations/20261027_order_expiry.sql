-- Additive migration for checkout debugging and unpaid-order expiry. Also in
-- schema.sql; safe to run more than once.
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

