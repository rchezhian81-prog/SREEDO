-- Tenant Module Completion (v2) — documents, CRM/consent columns, "closed"
-- lifecycle status. ADDITIVE & SAFE: no column dropped, no data deleted, no
-- tenant ever hard-deleted (documents archive/delete is row-level only and
-- preserves the institution + its invoices/audit history).

-- 1) Add the terminal "closed" lifecycle status (tenant has exited the platform).
--    Recreate the named CHECK from 0081 to include it. is_active stays false for
--    closed tenants (handled in the service alongside suspended/expired/archived).
ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_status_check;
ALTER TABLE institutions
  ADD CONSTRAINT institutions_status_check
  CHECK (status IN ('draft', 'trial', 'active', 'suspended', 'expired', 'archived', 'closed'));

-- 2) Lightweight CRM / compliance columns surfaced in the tenant detail.
ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS account_manager TEXT,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_processing_consent BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Tenant documents (registration cert, agreement, KYC, etc). Bytes live in the
--    shared storage layer (S3 or local disk); only metadata + storage_key here.
--    Separate from the tenant-scoped `documents` table because this is a
--    super-admin/operator surface keyed by institution, not by a tenant caller.
CREATE TABLE IF NOT EXISTS tenant_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('registration', 'trust_company', 'gst', 'pan_tan',
                        'agreement', 'authorization', 'logo', 'other')),
  original_name TEXT NOT NULL,
  safe_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_mode TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verification_remarks TEXT,
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_documents_institution_idx
  ON tenant_documents(institution_id, created_at DESC);
