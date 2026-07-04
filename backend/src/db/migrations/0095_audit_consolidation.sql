-- Super Admin F — Audit Consolidation.
--
-- SAFE & ADDITIVE, idempotent. Builds the governed console on top of the EXISTING
-- durable audit store (platform_audit_log). NOTHING here deletes, rewrites, or
-- purges audit history: category / severity / result are DERIVED from the action
-- string (and detail) at read time, not stored. This migration adds only:
--   • two user-facing tables (saved filters + a retention-policy singleton),
--   • two permission keys (granted to super_admin; audit_export also to auditor),
--   • two read indexes the console needs that 0039/0078/0094 do not already cover.
-- No table/column is dropped, no row modified, and no audit row is ever removed.
-- Automated retention purge / archive is explicitly a FUTURE job — the retention
-- config below is policy VISIBILITY only and never deletes rows.

-- 1. Saved audit filters. Personal by default (owner_id); is_shared makes a filter
--    visible to every platform super_admin. ON DELETE CASCADE ties a user's saved
--    filters to their account (a filter is not audit history — hard delete is fine).
CREATE TABLE IF NOT EXISTS audit_saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_saved_filters_owner_idx ON audit_saved_filters(owner_id);
CREATE INDEX IF NOT EXISTS audit_saved_filters_shared_idx ON audit_saved_filters(is_shared) WHERE is_shared;

-- 2. Retention-policy singleton (id = TRUE). "empty = safe": defaults describe a
--    not-configured policy that changes nothing. updated_by is intentionally a bare
--    UUID (no FK) so the singleton survives a users TRUNCATE in tests and never
--    disappears. NOTE: this table records POLICY INTENT only — no job reads it to
--    delete rows; automated purge/archive is a documented future enhancement.
CREATE TABLE IF NOT EXISTS audit_retention_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  status TEXT NOT NULL DEFAULT 'not_configured',
  retention_days INT,
  archive_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID,
  updated_by_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO audit_retention_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- 3. Permission keys. super_admin bypasses permission checks in code, but every
--    migration still records the authoritative grant. audit_export is additionally
--    granted to the read-only auditor built-in (exporting the audit log is a core
--    auditor task). No OTHER role's permission set changes.
INSERT INTO permissions (key, description) VALUES
  ('platform:audit_export', 'Export the platform audit log'),
  ('platform:audit_manage', 'Manage audit retention and shared saved filters')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT v.role, p.id
FROM (VALUES
  ('super_admin', 'platform:audit_export'),
  ('super_admin', 'platform:audit_manage'),
  ('auditor',     'platform:audit_export')
) AS v(role, key)
JOIN permissions p ON p.key = v.key
ON CONFLICT (role, permission_id) DO NOTHING;

-- 4. Read indexes the consolidated console needs that do NOT already exist.
--    (created_at, action, actor_id, institution_id, target_type are indexed by
--    0039/0078/0094 — not duplicated here.) Additive only.
CREATE INDEX IF NOT EXISTS platform_audit_log_ip_idx ON platform_audit_log(ip);
CREATE INDEX IF NOT EXISTS platform_audit_log_target_idx ON platform_audit_log(target_type, target_id);
