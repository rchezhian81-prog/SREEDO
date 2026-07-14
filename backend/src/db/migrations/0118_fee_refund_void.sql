-- PR-F02Ra — Fee-refund ledger reconciliation. Additive, idempotent: no data is
-- deleted or rewritten here. Adds soft-void columns to payment_refunds so a
-- refund can be reversed WITHOUT deleting the historical record (replacing the
-- old hard DELETE). A voided refund is excluded from the refundable/net-paid
-- computation but the row is preserved for audit.

ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE payment_refunds ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE payment_refunds
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL;
