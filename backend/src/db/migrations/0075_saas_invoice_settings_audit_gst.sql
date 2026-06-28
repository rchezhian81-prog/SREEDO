-- Billing B2.2 P0 — invoice settings, email delivery log, audit metadata and
-- GST-readiness fields (ADDITIVE & SAFE). No existing column is changed and no
-- data is deleted. Money-action AUDIT reuses the existing platform_audit_log
-- table (target_type = 'saas_invoice'); no new audit table is introduced.

-- 1. Platform invoice settings (single row): supplier profile, numbering, billing
--    defaults, bank/UPI, and PDF/email presentation. The classic singleton guard
--    keeps exactly one row.
CREATE TABLE IF NOT EXISTS invoice_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  -- numbering / series
  prefix TEXT NOT NULL DEFAULT 'SINV-',
  fy_start_month INT NOT NULL DEFAULT 4 CHECK (fy_start_month BETWEEN 1 AND 12),
  number_padding INT NOT NULL DEFAULT 6 CHECK (number_padding BETWEEN 1 AND 12),
  -- billing defaults applied to new drafts
  default_currency TEXT NOT NULL DEFAULT 'INR',
  default_tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (default_tax_percent >= 0),
  default_sac TEXT,
  default_due_days INT CHECK (default_due_days IS NULL OR default_due_days >= 0),
  -- supplier (operator) profile, printed on the PDF "from" block
  supplier_legal_name TEXT,
  supplier_trade_name TEXT,
  supplier_address TEXT,
  supplier_gstin TEXT,
  supplier_pan TEXT,
  supplier_state TEXT,
  supplier_state_code TEXT,
  supplier_email TEXT,
  supplier_phone TEXT,
  bank_details TEXT,
  upi_id TEXT,
  -- PDF presentation
  pdf_footer TEXT,
  pdf_terms TEXT,
  signatory_name TEXT,
  logo_path TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Seed the single settings row with safe defaults (idempotent).
INSERT INTO invoice_settings (id, supplier_legal_name)
VALUES (TRUE, 'SRE EDU OS')
ON CONFLICT (id) DO NOTHING;

-- 2. Email delivery log — one row per send attempt (issue / resend / reminders).
CREATE TABLE IF NOT EXISTS invoice_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES saas_invoices(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'invoice_issued',
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error TEXT,
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_emails_invoice_idx
  ON invoice_emails(invoice_id, created_at DESC);

-- 3. Audit metadata + GST-readiness fields on the invoice header.
ALTER TABLE saas_invoices
  ADD COLUMN IF NOT EXISTS issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS round_off NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- GST readiness (fields only; flat tax_percent calculation is unchanged)
  ADD COLUMN IF NOT EXISTS sac_code TEXT,
  ADD COLUMN IF NOT EXISTS place_of_supply TEXT,
  ADD COLUMN IF NOT EXISTS reverse_charge BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS supplier_state TEXT,
  ADD COLUMN IF NOT EXISTS supplier_state_code TEXT,
  ADD COLUMN IF NOT EXISTS recipient_state TEXT,
  ADD COLUMN IF NOT EXISTS recipient_state_code TEXT;

-- Per-line SAC/HSN (GST readiness; optional).
ALTER TABLE saas_invoice_lines
  ADD COLUMN IF NOT EXISTS sac_code TEXT;
