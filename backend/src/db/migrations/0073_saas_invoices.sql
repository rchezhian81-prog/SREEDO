-- Billing Phase B2 — gateway-free SaaS invoicing.
--
-- Lets the operator issue subscription invoices to institutions and record
-- OFFLINE payment (bank transfer / cheque / UPI reference). ADDITIVE & SAFE:
-- new tables + a sequence only; no existing table is modified and no data is
-- deleted. There is NO payment gateway and NO auto-charging — an invoice is
-- marked paid manually by a super-admin.

CREATE SEQUENCE IF NOT EXISTS saas_invoice_seq;

CREATE TABLE IF NOT EXISTS saas_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  number TEXT UNIQUE,                       -- assigned on issue; NULL while draft
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'paid', 'void')),
  currency TEXT NOT NULL DEFAULT 'INR',
  period_start DATE,
  period_end DATE,
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (tax_percent >= 0),
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes TEXT,
  issued_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER saas_invoices_set_updated_at
  BEFORE UPDATE ON saas_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS saas_invoices_institution_idx
  ON saas_invoices(institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS saas_invoices_status_idx ON saas_invoices(status);

CREATE TABLE IF NOT EXISTS saas_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES saas_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saas_invoice_lines_invoice_idx
  ON saas_invoice_lines(invoice_id);
