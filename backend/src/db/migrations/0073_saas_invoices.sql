-- Billing Phase B2 — gateway-free SaaS invoicing.
--
-- Lets the operator invoice institutions for their subscription and record
-- OFFLINE payment (bank transfer / cheque / UPI reference). ADDITIVE & SAFE:
-- new tables only; no existing table is modified and no data is deleted. There
-- is NO payment gateway and NO auto-charging — an invoice is marked paid
-- manually by a super-admin.
--
-- Invoice numbers are financial-year segmented (e.g. SINV-FY2026-27-000001),
-- assigned only when an invoice is ISSUED (drafts never consume a number) and
-- immutable thereafter — backed by the per-FY counter table below.

CREATE TABLE IF NOT EXISTS saas_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  -- Optional link to the package being billed (free-form lines remain the source
  -- of truth for amounts); never required to create an invoice.
  package_id UUID REFERENCES subscription_packages(id) ON DELETE SET NULL,
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
  -- Optional billing details, captured at draft time and printed on the PDF.
  -- (Flat tax only for now; full CGST/SGST/IGST is a later B2.1 after review.)
  gstin TEXT,
  billing_name TEXT,
  billing_address TEXT,
  tax_notes TEXT,
  notes TEXT,
  issued_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  payment_reference TEXT,
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

-- Financial-year-segmented invoice-number counters. One row per FY label
-- (e.g. 'FY2026-27'); the value is atomically incremented when an invoice is
-- issued, so drafts never consume a number and numbers stay gap-free per FY.
CREATE TABLE IF NOT EXISTS saas_invoice_counters (
  fy TEXT PRIMARY KEY,
  last_value INT NOT NULL DEFAULT 0
);
