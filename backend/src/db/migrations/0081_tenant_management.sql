-- Tenant / Institution Management — profile, type, lifecycle, onboarding,
-- compliance, internal notes (ADDITIVE & SAFE).
--
-- ONE common tenant model. A new tenant-facing `institution_type`
-- (school/college/university/coaching/other) drives academic structure, type-
-- based settings, labels and onboarding. The EXISTING structural `type`
-- (school/college) and its cached requireInstitutionType() guard are UNCHANGED —
-- the service derives `type` from `institution_type` on write (school→school;
-- college/university/coaching/other→college-style program structure). No existing
-- column is dropped and no data is deleted.
--
-- academic_structure / enabled_modules / school_settings / college_settings are
-- stored in institutions.settings (jsonb) — no new columns for those.

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS institution_type TEXT NOT NULL DEFAULT 'school'
    CHECK (institution_type IN ('school', 'college', 'university', 'coaching', 'other')),
  -- profile
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS short_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS academic_year TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  -- lifecycle (kept in sync with is_active by the service for back-compat)
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'trial', 'active', 'suspended', 'expired', 'archived')),
  ADD COLUMN IF NOT EXISTS onboarding JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- compliance / approval
  ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS agreement_signed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (kyc_status IN ('pending', 'verified', 'rejected')),
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approval_remarks TEXT,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Backfill from existing state (idempotent; safe to re-run).
UPDATE institutions SET institution_type = type WHERE type IN ('school', 'college');
UPDATE institutions SET status = 'suspended' WHERE NOT is_active AND status = 'active';
UPDATE institutions SET slug = lower(code) WHERE slug IS NULL;

-- Slug is unique when set (tenant URL / subdomain); nulls allowed.
CREATE UNIQUE INDEX IF NOT EXISTS institutions_slug_key
  ON institutions(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS institutions_institution_type_idx ON institutions(institution_type);
CREATE INDEX IF NOT EXISTS institutions_status_idx ON institutions(status);

-- Internal super-admin CRM notes per tenant (NEVER visible to tenant users).
CREATE TABLE IF NOT EXISTS institution_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL DEFAULT 'general'
    CHECK (note_type IN ('sales', 'support', 'billing', 'technical', 'general')),
  body TEXT NOT NULL,
  follow_up_date DATE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS institution_notes_institution_idx
  ON institution_notes(institution_id, created_at DESC);

CREATE TRIGGER institution_notes_set_updated_at
  BEFORE UPDATE ON institution_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
