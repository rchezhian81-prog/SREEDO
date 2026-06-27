-- Super Admin Console — Platform Hardening. Adds an explicit platform permission
-- set and a DURABLE cross-tenant audit trail for platform (super-admin) actions.
-- The existing request-level audit log lives in MongoDB (best-effort, optional);
-- this table is the authoritative, always-available record of lifecycle /
-- subscription / impersonation actions, queryable by the platform audit viewer.
-- All platform routes remain super-admin-only (institution_id = null actor).

CREATE TABLE platform_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,                 -- e.g. institution.suspend, subscription.assign
  target_type TEXT NOT NULL,            -- institution | subscription | limits | user
  target_id UUID,
  institution_id UUID,                  -- the affected tenant (nullable)
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,  -- curated, non-secret summary of the change
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_log_created_idx ON platform_audit_log(created_at DESC);
CREATE INDEX platform_audit_log_institution_idx ON platform_audit_log(institution_id, created_at DESC);
CREATE INDEX platform_audit_log_action_idx ON platform_audit_log(action);

-- Platform permissions (super-admin only; tenant roles never receive these).
INSERT INTO permissions (key, description) VALUES
  ('platform:read', 'View platform institutions and overview'),
  ('platform:manage_institutions', 'Create / update / suspend / activate institutions'),
  ('platform:manage_subscriptions', 'Assign packages and set institution limits'),
  ('platform:audit_read', 'View the cross-tenant platform audit log'),
  ('platform:health_read', 'View platform health'),
  ('platform:impersonate', 'Start a support impersonation session'),
  ('platform:usage_read', 'View platform-wide KPIs and usage');

-- Grant the full platform set to super_admin only. (super_admin already bypasses
-- permission checks, but the explicit grants document the intended model and keep
-- role_permissions authoritative; NO tenant role is granted any platform:* key.)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'super_admin', id FROM permissions WHERE key LIKE 'platform:%';
