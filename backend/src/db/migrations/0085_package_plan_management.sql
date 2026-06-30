-- Super Admin C — Package / Plan Management completion. ADDITIVE & SAFE: extends
-- subscription_packages with SaaS plan-admin fields and adds version-history +
-- a future-ready add-ons table. Existing columns (name, max_students, max_staff,
-- price, billing_cycle, features, is_active, created_at) are preserved so current
-- consumers (subscriptions dropdown, tenant assign, effectiveLimits) keep working.
-- No package is ever hard-deleted (institution_subscriptions.package_id is ON
-- DELETE RESTRICT); archive = status change. Changes are audited via
-- platform_audit_log + the new package_versions trail.

-- 1. Plan-admin columns on subscription_packages -------------------------------
ALTER TABLE subscription_packages
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS badge TEXT,
  ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0,
  -- empty array = applies to ALL institution types; else a subset
  ADD COLUMN IF NOT EXISTS applicable_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS setup_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_start_rule TEXT NOT NULL DEFAULT 'immediate',
  ADD COLUMN IF NOT EXISTS invoice_due_days INT,
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  -- flat tax percent only (mirrors the existing invoice flat-tax convention)
  ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sac_hsn TEXT,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS grace_days INT,
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_days INT,
  ADD COLUMN IF NOT EXISTS trial_expiry_behavior TEXT,
  ADD COLUMN IF NOT EXISTS trial_conversion_package_id UUID
    REFERENCES subscription_packages(id) ON DELETE SET NULL,
  -- extended numeric limits beyond max_students/max_staff (kept as columns for
  -- backward compat); e.g. { users, teachers, parents, branches, classes,
  -- storageMb, documents, smsQuota, emailQuota, whatsappQuota, apiRequests,
  -- reports, scheduledReports, supportSessions }
  ADD COLUMN IF NOT EXISTS limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Constraints (added separately so re-runs are tolerant). Guarded by catalog
-- checks because ADD CONSTRAINT has no IF NOT EXISTS in PG16.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_packages_status_check2') THEN
    ALTER TABLE subscription_packages ADD CONSTRAINT subscription_packages_status_check2
      CHECK (status IN ('active','draft','deprecated','archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_packages_visibility_check') THEN
    ALTER TABLE subscription_packages ADD CONSTRAINT subscription_packages_visibility_check
      CHECK (visibility IN ('public','internal','hidden'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_packages_billing_start_check') THEN
    ALTER TABLE subscription_packages ADD CONSTRAINT subscription_packages_billing_start_check
      CHECK (billing_start_rule IN ('immediate','after_trial','custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_packages_trial_behavior_check') THEN
    ALTER TABLE subscription_packages ADD CONSTRAINT subscription_packages_trial_behavior_check
      CHECK (trial_expiry_behavior IS NULL OR trial_expiry_behavior IN ('expire','suspend','convert_manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_packages_setup_fee_check') THEN
    ALTER TABLE subscription_packages ADD CONSTRAINT subscription_packages_setup_fee_check
      CHECK (setup_fee >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_packages_tax_percent_check') THEN
    ALTER TABLE subscription_packages ADD CONSTRAINT subscription_packages_tax_percent_check
      CHECK (tax_percent >= 0);
  END IF;
END $$;

-- Backfill: existing inactive packages surface as 'archived'; active stay 'active'.
UPDATE subscription_packages SET status = 'archived' WHERE is_active = FALSE AND status = 'active';

CREATE INDEX IF NOT EXISTS subscription_packages_status_idx ON subscription_packages(status);
CREATE INDEX IF NOT EXISTS subscription_packages_billing_cycle_idx ON subscription_packages(billing_cycle);
CREATE INDEX IF NOT EXISTS subscription_packages_display_order_idx ON subscription_packages(display_order);
CREATE INDEX IF NOT EXISTS subscription_packages_applicable_types_idx ON subscription_packages USING GIN (applicable_types);
-- Speeds up "tenants using this package" (only institution_id was indexed before).
CREATE INDEX IF NOT EXISTS institution_subscriptions_package_id_idx ON institution_subscriptions(package_id);

-- 2. Package change/version history (before/after diff + actor + reason) --------
CREATE TABLE IF NOT EXISTS package_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES subscription_packages(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  action TEXT NOT NULL, -- created | updated | status_change | archived | duplicated
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS package_versions_package_idx ON package_versions(package_id, created_at DESC);

-- 3. Add-ons — FUTURE-READY schema only (no billing wired in this PR). Provides a
--    safe place for extra-students / storage / SMS packs etc. without touching the
--    invoice flow. Documented as a future follow-up.
CREATE TABLE IF NOT EXISTS package_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES subscription_packages(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, key)
);
