-- Billing B2.2 — invoice due dates & payment terms (ADDITIVE & SAFE).
--
-- Adds optional due-date tracking to gateway-free SaaS invoices so the operator
-- can set payment terms (e.g. Net 15) and surface OVERDUE invoices. No existing
-- column is modified and no data is deleted. "Overdue" is computed at query time
-- (status = 'issued' AND due_date < today), NOT stored, so there is no status
-- enum change and no background sweep — the value is always current.

ALTER TABLE saas_invoices
  ADD COLUMN IF NOT EXISTS payment_terms_days INT
    CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  ADD COLUMN IF NOT EXISTS due_date DATE;

-- Speeds up the overdue filter/sort on the global invoice list. Partial index:
-- only issued invoices can be overdue, so paid/void/draft rows stay out of it.
CREATE INDEX IF NOT EXISTS saas_invoices_due_date_idx
  ON saas_invoices(due_date)
  WHERE status = 'issued';
