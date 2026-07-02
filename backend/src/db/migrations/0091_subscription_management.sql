-- Super Admin D — Subscription lifecycle control center.
--
-- SAFE & ADDITIVE: only new tables/columns/indexes + one seeded singleton row.
-- Builds on B1 (0072 subscription_lifecycle: lifecycle columns + subscription_events)
-- and B4 (0090 recurring/dunning). No existing row is modified or deleted; nothing
-- here changes behaviour until an operator edits the config or takes an action.

-- 1. DB-backed lifecycle configuration (singleton id=1). Seeded from the B1 env
--    defaults so the sweep behaves identically until an operator edits it. The
--    sweep reads this row and falls back to the env values when a field is null.
CREATE TABLE IF NOT EXISTS subscription_lifecycle_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  trial_days INT NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 0 AND 365),
  grace_days INT NOT NULL DEFAULT 14 CHECK (grace_days BETWEEN 0 AND 180),
  -- days BEFORE expiry to send renewal reminders
  renewal_reminder_days INT[] NOT NULL DEFAULT '{14,7,1}',
  -- days AFTER expiry to send expiry reminders (0 = on the expiry day)
  expiry_reminder_days INT[] NOT NULL DEFAULT '{0,7}',
  auto_expire_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_suspend_enabled BOOLEAN NOT NULL DEFAULT false,
  billing_overdue_suspend_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO subscription_lifecycle_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. Internal subscription CRM notes (Super Admin / platform only). Soft-delete
--    only (deleted_at) so history is preserved — never hard-deleted.
CREATE TABLE IF NOT EXISTS subscription_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES institution_subscriptions(id) ON DELETE SET NULL,
  note_type TEXT NOT NULL DEFAULT 'general'
    CHECK (note_type IN ('renewal', 'billing', 'support', 'cancellation', 'upgrade', 'general')),
  body TEXT NOT NULL,
  follow_up_date DATE,
  owner TEXT,                       -- responsible person / account owner (free text)
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ            -- soft-delete marker; row is kept
);
CREATE INDEX IF NOT EXISTS subscription_notes_institution_idx
  ON subscription_notes(institution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_notes_followup_idx
  ON subscription_notes(follow_up_date) WHERE follow_up_date IS NOT NULL AND deleted_at IS NULL;

-- 3. Renewal-reminder send history (manual + automated). Preserved; append-only.
CREATE TABLE IF NOT EXISTS subscription_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES institution_subscriptions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'before_expiry'
    CHECK (kind IN ('before_expiry', 'on_expiry', 'after_expiry', 'manual')),
  to_email TEXT,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error TEXT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_reminders_institution_idx
  ON subscription_reminders(institution_id, created_at DESC);

-- 4. First-class reason on the lifecycle audit trail (previously carried only in
--    the detail JSONB). High-risk actions require a reason; storing it as a column
--    keeps it queryable and reportable.
ALTER TABLE subscription_events
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- 5. Lifecycle / renewal-calendar query indexes (find due-soon quickly).
CREATE INDEX IF NOT EXISTS institution_subscriptions_renews_at_idx
  ON institution_subscriptions(renews_at) WHERE renews_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS institution_subscriptions_trial_ends_idx
  ON institution_subscriptions(trial_ends_at) WHERE trial_ends_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS institution_subscriptions_ends_at_idx
  ON institution_subscriptions(ends_at) WHERE ends_at IS NOT NULL;
