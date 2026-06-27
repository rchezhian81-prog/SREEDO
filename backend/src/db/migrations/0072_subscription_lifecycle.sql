-- Billing Phase B1 — subscription lifecycle (expiry, grace, auto-suspend,
-- renewal reminders, status tracking) + a durable audit trail of subscription
-- changes.
--
-- SAFE & ADDITIVE: only adds columns/tables/indexes and widens a CHECK
-- constraint. No existing row is modified or deleted; perpetual subscriptions
-- (NULL ends_at) keep working unchanged. No payment-gateway coupling.

-- 1. Lifecycle columns on the existing subscriptions table (nullable / defaulted
--    so existing rows are valid as-is).
ALTER TABLE institution_subscriptions
  ADD COLUMN IF NOT EXISTS renews_at DATE,
  ADD COLUMN IF NOT EXISTS grace_until DATE,
  ADD COLUMN IF NOT EXISTS trial_ends_at DATE,
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_reminder_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reminder_day INT;

-- 2. Allow the new terminal status 'expired' (keep every existing value). The
--    original inline CHECK is auto-named <table>_status_check.
ALTER TABLE institution_subscriptions
  DROP CONSTRAINT IF EXISTS institution_subscriptions_status_check;
ALTER TABLE institution_subscriptions
  ADD CONSTRAINT institution_subscriptions_status_check
  CHECK (status IN ('active', 'trialing', 'suspended', 'cancelled', 'expired'));

-- 3. Index for the lifecycle sweep (find due subscriptions quickly).
CREATE INDEX IF NOT EXISTS institution_subscriptions_status_ends_idx
  ON institution_subscriptions(status, ends_at);

-- 4. Durable, queryable audit of subscription lifecycle changes. Separate from
--    platform_audit_log so it can be surfaced per-institution without exposing
--    the cross-tenant platform log. actor_id NULL = an automated/system change.
CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES institution_subscriptions(id) ON DELETE SET NULL,
  event TEXT NOT NULL,            -- expired | trial_expired | grace_started | auto_suspended | reminder_sent | status_changed | renewed
  from_status TEXT,
  to_status TEXT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_events_institution_idx
  ON subscription_events(institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_events_event_idx
  ON subscription_events(event);
