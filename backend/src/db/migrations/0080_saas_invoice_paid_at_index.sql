-- Invoice P1 — index paid_at for the paid-date-range filter / payment reports.
-- ADDITIVE & SAFE: a new index only; no column or data is changed. Partial — only
-- 'paid' invoices carry a meaningful paid_at, which mirrors how the list/export
-- filter on payment date (paymentStatus=paid, paidFrom/paidTo).
CREATE INDEX IF NOT EXISTS saas_invoices_paid_at_idx
  ON saas_invoices(paid_at)
  WHERE status = 'paid';
