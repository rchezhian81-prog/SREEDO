-- Super Admin G — Support Access Hardening (Phase 1).
--
-- Turns the fire-and-forget impersonation row into a STATEFUL, SCOPE-ENFORCED,
-- REVOCABLE, AUDITED support session. This migration is strictly ADDITIVE and
-- IDEMPOTENT: it only ADDs columns/indexes/permissions (all IF NOT EXISTS /
-- ON CONFLICT DO NOTHING) to `platform_impersonation_sessions` and never drops
-- or deletes any session history. `created_at` remains the session start time.

ALTER TABLE platform_impersonation_sessions
  ADD COLUMN IF NOT EXISTS institution_id  UUID,
  ADD COLUMN IF NOT EXISTS target_role     TEXT,
  ADD COLUMN IF NOT EXISTS reason_template TEXT,
  ADD COLUMN IF NOT EXISTS scope           TEXT NOT NULL DEFAULT 'read_only',
  ADD COLUMN IF NOT EXISTS allowed_modules TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS ended_by        UUID,
  ADD COLUMN IF NOT EXISTS revoked_by      UUID,
  ADD COLUMN IF NOT EXISTS revoke_reason   TEXT,
  ADD COLUMN IF NOT EXISTS ip              TEXT,
  ADD COLUMN IF NOT EXISTS user_agent      TEXT,
  -- Reserved for the Phase-2 tenant-notification work (added now to avoid a second
  -- migration); nullable and untouched by Phase 1.
  ADD COLUMN IF NOT EXISTS notify_status   TEXT,
  ADD COLUMN IF NOT EXISTS notify_detail   JSONB;

-- Backfill: legacy rows that were already ended should read 'ended' rather than the
-- new 'active' default. Safe + idempotent (only touches rows still marked active).
UPDATE platform_impersonation_sessions
   SET status = 'ended'
 WHERE ended_at IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS pis_status_idx      ON platform_impersonation_sessions(status);
CREATE INDEX IF NOT EXISTS pis_institution_idx ON platform_impersonation_sessions(institution_id);
CREATE INDEX IF NOT EXISTS pis_target_idx      ON platform_impersonation_sessions(target_id);
CREATE INDEX IF NOT EXISTS pis_actor_idx       ON platform_impersonation_sessions(actor_id);
CREATE INDEX IF NOT EXISTS pis_expires_idx     ON platform_impersonation_sessions(expires_at);
CREATE INDEX IF NOT EXISTS pis_created_idx      ON platform_impersonation_sessions(created_at);

-- Granular support-access permissions (platform layer). super_admin bypasses
-- permission checks at runtime; the explicit grants document the intended
-- operator model and keep role_permissions authoritative. role_permissions.role
-- is TEXT, so forward-looking operator roles can be granted before they exist.
INSERT INTO permissions (key, description) VALUES
  ('platform:support_read',   'View support-access sessions, history, summary and security posture'),
  ('platform:support_start',  'Start / end a scoped support-access (impersonation) session'),
  ('platform:support_revoke', 'Revoke or force-end support-access sessions')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
  SELECT 'super_admin', id FROM permissions
   WHERE key IN ('platform:support_read', 'platform:support_start', 'platform:support_revoke')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
  SELECT 'support_operator', id FROM permissions
   WHERE key IN ('platform:support_read', 'platform:support_start')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
  SELECT 'auditor', id FROM permissions
   WHERE key IN ('platform:support_read')
ON CONFLICT (role, permission_id) DO NOTHING;
