-- 0086: Super Admin C-1 — package billing deltas.
-- Adds the half-yearly billing cycle and a package-level default tax category.
-- billing_cycle is a stored label only (no lifecycle/invoice date math branches on
-- it), so widening the CHECK is safe. tax_category is a forward-compatible default
-- consumed by the GST engine in a later PR.

-- Widen billing_cycle: monthly/quarterly/annual -> + half_yearly.
-- Drop the existing CHECK by discovering its name (inline checks from 0011 are
-- auto-named), then re-add the widened one. Idempotent on manual re-apply.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'subscription_packages'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%billing_cycle%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE subscription_packages DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE subscription_packages
  ADD CONSTRAINT subscription_packages_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'quarterly', 'half_yearly', 'annual'));

-- Package default tax category (e.g. standard / exempt / zero_rated). Free label
-- for now; the GST engine PR formalises how it maps to GST rates.
ALTER TABLE subscription_packages ADD COLUMN IF NOT EXISTS tax_category TEXT;
