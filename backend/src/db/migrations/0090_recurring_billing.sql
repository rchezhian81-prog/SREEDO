-- Billing Phase B4 — Online recurring billing + dunning.
--
-- Extends the C-4 SaaS Razorpay gateway (0089) and the B1 subscription
-- lifecycle (0072) so the operator can (optionally) auto-charge subscription
-- renewals and run a dunning retry schedule that ends in a suspend.
--
-- SAFE & ADDITIVE: only adds nullable/defaulted columns. Everything is OFF by
-- default (auto_charge = false per subscription, auto_charge_enabled = false on
-- the singleton gateway settings), so no existing tenant is charged or changed
-- until an operator explicitly opts in AND the gateway is configured. No column
-- from B1 (renews_at / grace_until / trial_ends_at / auto_renew) is re-added.

-- 1. Recurring/dunning state on the subscription. Gateway customer/subscription
--    references are stored (never card data). dunning_state drives the retry
--    machine; next_retry_at is when the worker should next act.
ALTER TABLE institution_subscriptions
  ADD COLUMN IF NOT EXISTS gateway_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS gateway_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS auto_charge BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dunning_state TEXT NOT NULL DEFAULT 'none'
    CHECK (dunning_state IN ('none', 'retrying', 'exhausted')),
  ADD COLUMN IF NOT EXISTS dunning_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_charge_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payment_error TEXT;

-- 2. Policy fields on the singleton gateway-settings row. auto_charge_enabled is
--    the master switch for the whole feature (defaults false). Bounds are also
--    enforced in the zod schema; the CHECKs are defence-in-depth.
ALTER TABLE saas_payment_gateway_settings
  ADD COLUMN IF NOT EXISTS auto_charge_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dunning_max_attempts INT NOT NULL DEFAULT 3
    CHECK (dunning_max_attempts BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS dunning_retry_interval_days INT NOT NULL DEFAULT 3
    CHECK (dunning_retry_interval_days BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS suspend_on_dunning_exhausted BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS renewal_lead_days INT NOT NULL DEFAULT 0
    CHECK (renewal_lead_days BETWEEN 0 AND 30);

-- 3. Mark auto-generated renewal invoices so the worker/webhook can find the
--    open renewal invoice for a subscription (and so reports can distinguish
--    them from manually-created ones). Existing invoices stay is_renewal = false.
ALTER TABLE saas_invoices
  ADD COLUMN IF NOT EXISTS is_renewal BOOLEAN NOT NULL DEFAULT false;

-- 4. Indexes for the recurring/dunning sweep (find due-to-renew and due-to-retry
--    subscriptions quickly) and open renewal invoices per institution.
CREATE INDEX IF NOT EXISTS institution_subscriptions_next_retry_idx
  ON institution_subscriptions(next_retry_at)
  WHERE next_retry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS institution_subscriptions_auto_charge_idx
  ON institution_subscriptions(auto_charge, status)
  WHERE auto_charge = true;
CREATE INDEX IF NOT EXISTS saas_invoices_renewal_open_idx
  ON saas_invoices(institution_id, status)
  WHERE is_renewal = true;
