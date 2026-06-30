-- 0087: Super Admin C-2 — coupon / promotion system + safe pre-tax invoice discount.
-- Coupons are a Super Admin billing control. Discounts apply ONLY to draft invoices
-- (pre-issue); issuing freezes the discount + records one redemption. Existing/non-coupon
-- invoices are unaffected because discount_amount defaults to 0 and the recompute formula
-- is identical when discount_amount = 0.

CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT,
  description TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value >= 0),
  max_discount_amount NUMERIC(12,2) CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  min_invoice_amount NUMERIC(12,2) CHECK (min_invoice_amount IS NULL OR min_invoice_amount >= 0),
  valid_from DATE,
  valid_until DATE,
  total_usage_limit INT CHECK (total_usage_limit IS NULL OR total_usage_limit >= 0),
  per_tenant_usage_limit INT CHECK (per_tenant_usage_limit IS NULL OR per_tenant_usage_limit >= 0),
  applicable_packages UUID[] NOT NULL DEFAULT '{}',
  applicable_types TEXT[] NOT NULL DEFAULT '{}',
  applicable_billing_cycles TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'expired', 'disabled')),
  internal_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- percentage coupons cannot exceed 100%
  CONSTRAINT coupons_percentage_range CHECK (discount_type <> 'percentage' OR discount_value <= 100)
);
CREATE INDEX IF NOT EXISTS coupons_status_idx ON coupons(status);
CREATE INDEX IF NOT EXISTS coupons_code_lower_idx ON coupons(lower(code));

-- One redemption row per ISSUED invoice that carried a coupon (the usage record).
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  invoice_id UUID REFERENCES saas_invoices(id) ON DELETE SET NULL,
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_tenant_idx ON coupon_redemptions(coupon_id, institution_id);
-- never more than one redemption per invoice (idempotent issue)
CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_invoice_uniq ON coupon_redemptions(invoice_id) WHERE invoice_id IS NOT NULL;

-- Invoice carries the applied coupon + frozen discount (snapshot survives coupon edits).
ALTER TABLE saas_invoices
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
