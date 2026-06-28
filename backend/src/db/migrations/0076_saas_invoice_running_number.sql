-- Settable, continuous invoice numbering (ADDITIVE & SAFE).
--
-- Adds a single running counter to invoice_settings so the operator can set the
-- starting/next number once and issuance auto-continues from there — one
-- ever-increasing series (it does NOT reset per financial year; the FY label in
-- the number string still reflects the issue date). No existing column changes.

ALTER TABLE invoice_settings
  ADD COLUMN IF NOT EXISTS next_invoice_number BIGINT NOT NULL DEFAULT 1
    CHECK (next_invoice_number >= 1);

-- Seed the running counter just ABOVE any already-issued number, so switching to
-- the continuous series can never collide with an existing invoice number.
-- (Reads the trailing digit-group of each issued number, e.g. ...-000003 → 3.)
UPDATE invoice_settings SET next_invoice_number = GREATEST(
  next_invoice_number,
  COALESCE(
    (SELECT MAX((regexp_match(number, '(\d+)$'))[1]::bigint)
       FROM saas_invoices WHERE number ~ '\d+$'),
    0
  ) + 1
)
WHERE id = TRUE;
