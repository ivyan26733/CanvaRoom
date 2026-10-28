-- Additive migration: link manual grants to the payment they record. Also in schema.sql.
-- A manual Premium grant that was paid for (cash, bank transfer...) records
-- that money as a 'manual' payment, linked here, so it counts as revenue.
ALTER TABLE admin_access_grants ADD COLUMN IF NOT EXISTS payment_order_id text;

