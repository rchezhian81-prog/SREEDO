-- 0088: Super Admin C-3 — full GST engine (CGST / SGST / IGST split).
-- Adds the GST breakdown columns to saas_invoices. tax_percent stays the TOTAL GST
-- rate; the split is derived at recompute time from supplier state (invoice_settings)
-- vs recipient state (invoice). Existing/issued invoices keep cgst/sgst/igst = 0 and
-- their frozen tax_amount/total — they are never recomputed, so history is unchanged.

ALTER TABLE saas_invoices
  ADD COLUMN IF NOT EXISTS cgst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_treatment TEXT NOT NULL DEFAULT 'registered';

-- Constrain gst_treatment (ADD CONSTRAINT has no IF NOT EXISTS in PG16).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saas_invoices_gst_treatment_check') THEN
    ALTER TABLE saas_invoices ADD CONSTRAINT saas_invoices_gst_treatment_check
      CHECK (gst_treatment IN ('registered', 'unregistered', 'sez', 'export', 'composition'));
  END IF;
END $$;
