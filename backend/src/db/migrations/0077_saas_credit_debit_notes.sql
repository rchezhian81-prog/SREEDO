-- Billing P2 — Credit & Debit notes (ADDITIVE & SAFE).
--
-- A note is a STANDALONE document linked to an ISSUED or PAID invoice; it never
-- modifies the original invoice. One unified table holds both kinds:
--   kind = 'credit'  → reduces what the institution owes (refund / adjustment)
--   kind = 'debit'   → an additional charge against the same invoice
-- Lifecycle mirrors invoices: draft → issue (assigns a continuous, settable
-- number) → void (reason required). Flat tax only — the same model as invoices
-- (full CGST/SGST/IGST remains out of scope). No existing table is modified
-- destructively and no data is deleted.

CREATE TABLE IF NOT EXISTS saas_invoice_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The invoice this note adjusts. The note is independent (its own document &
  -- number); deleting the invoice cascades the note away with it.
  invoice_id UUID NOT NULL REFERENCES saas_invoices(id) ON DELETE CASCADE,
  -- Denormalized tenant id (copied from the invoice) for fast per-tenant queries
  -- and audit, matching saas_invoices.institution_id.
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('credit', 'debit')),
  number TEXT UNIQUE,                        -- assigned on issue; NULL while draft
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'void')),
  reason TEXT,                               -- why the note exists (free text)
  currency TEXT NOT NULL DEFAULT 'INR',
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (tax_percent >= 0),
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  round_off NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  -- GST readiness (fields only; flat tax_percent calculation is unchanged) —
  -- mirrors saas_invoices so a note prints a consistent GST-ready document.
  sac_code TEXT,
  place_of_supply TEXT,
  reverse_charge BOOLEAN NOT NULL DEFAULT FALSE,
  supplier_state TEXT,
  supplier_state_code TEXT,
  recipient_state TEXT,
  recipient_state_code TEXT,
  notes TEXT,
  issued_at TIMESTAMPTZ,
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER saas_invoice_notes_set_updated_at
  BEFORE UPDATE ON saas_invoice_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS saas_invoice_notes_invoice_idx
  ON saas_invoice_notes(invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS saas_invoice_notes_institution_idx
  ON saas_invoice_notes(institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS saas_invoice_notes_status_idx
  ON saas_invoice_notes(status);

CREATE TABLE IF NOT EXISTS saas_invoice_note_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES saas_invoice_notes(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  sac_code TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_invoice_note_lines_note_idx
  ON saas_invoice_note_lines(note_id);

-- Continuous, settable numbering for notes — mirrors the invoice running number
-- (migration 0076). Credit and debit notes each have their OWN prefix + counter
-- (independent ever-increasing series, never reset per year). The FY label and
-- padding are shared with invoices (invoice_settings.fy_start_month / number_padding),
-- so an issued note reads e.g. CN-FY2026-27-000001 / DN-FY2026-27-000001.
ALTER TABLE invoice_settings
  ADD COLUMN IF NOT EXISTS credit_note_prefix TEXT NOT NULL DEFAULT 'CN-',
  ADD COLUMN IF NOT EXISTS debit_note_prefix TEXT NOT NULL DEFAULT 'DN-',
  ADD COLUMN IF NOT EXISTS next_credit_note_number BIGINT NOT NULL DEFAULT 1
    CHECK (next_credit_note_number >= 1),
  ADD COLUMN IF NOT EXISTS next_debit_note_number BIGINT NOT NULL DEFAULT 1
    CHECK (next_debit_note_number >= 1);
