-- Super Admin H — RBAC custom roles + platform-role permission enforcement.
--
-- SAFE & ADDITIVE: one new table (rbac_roles), seed data for the 6 built-in
-- platform roles + their permission grants (reusing the EXISTING permission
-- catalogue — no new permission keys), relaxes the users.platform_role CHECK so
-- custom role keys can be assigned (values are validated in the service against
-- rbac_roles), and indexes. No table/column dropped; no permission key removed.
--
-- Enforcement is delivered in code: requirePermission resolves a platform user's
-- effective permissions from their platform_role. 'owner' (and any super_admin
-- with platform_role NULL) keeps FULL access — so every existing session, test,
-- and production owner is unaffected; enforcement only narrows super_admins that
-- carry a NON-owner sub-role.

-- 1. Role metadata for the platform RBAC console (built-in templates + custom
--    roles). The permission grants themselves live in role_permissions keyed by
--    this role key (role_permissions.role is free TEXT).
CREATE TABLE IF NOT EXISTS rbac_roles (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('built_in', 'custom')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
  is_owner BOOLEAN NOT NULL DEFAULT false,   -- full access (bypasses permission checks)
  is_system BOOLEAN NOT NULL DEFAULT false,  -- built-in templates: protected from unsafe edits/delete
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rbac_roles_status_idx ON rbac_roles(status);
CREATE INDEX IF NOT EXISTS rbac_roles_kind_idx ON rbac_roles(kind);

-- 2. Seed the 6 built-in platform role templates. Owner is full-access + can
--    never be archived/deleted (enforced in the service + is_owner bypass).
INSERT INTO rbac_roles (key, name, description, kind, is_owner, is_system) VALUES
  ('owner', 'Owner / Super Admin', 'Full, unrestricted platform access. Cannot be archived or emptied; the last active owner is protected.', 'built_in', true, true),
  ('platform_admin', 'Platform Admin', 'Broad platform administration across tenants, billing, settings, health — excludes owner-critical actions (manage platform admins, manage RBAC) unless granted.', 'built_in', false, true),
  ('support_operator', 'Support Operator', 'Tenant read + support sessions (impersonation) for troubleshooting. No billing/settings/destructive access by default.', 'built_in', false, true),
  ('billing_admin', 'Billing Admin', 'Invoices, subscriptions, coupons, packages and billing reports. No platform-admin, RBAC or tenant/settings management by default.', 'built_in', false, true),
  ('auditor', 'Read-only Auditor', 'View-only access to tenants, billing, audit logs, reports and observability. No mutation.', 'built_in', false, true),
  ('technical_admin', 'Technical Admin', 'Health, jobs, backups and observability. No billing or security/owner actions by default.', 'built_in', false, true)
ON CONFLICT (key) DO NOTHING;

-- 3. Seed each built-in role's permission grants, reusing existing permission
--    keys (the JOIN silently drops any key that does not exist). Owner is NOT
--    granted rows here — its access comes from the is_owner bypass in code.
INSERT INTO role_permissions (role, permission_id)
SELECT v.role, p.id
FROM (VALUES
  -- Platform Admin: broad management, minus owner-critical (manage_admins, rbac_manage).
  ('platform_admin','platform:read'),
  ('platform_admin','platform:usage_read'),
  ('platform_admin','platform:health_read'),
  ('platform_admin','platform:audit_read'),
  ('platform_admin','platform:manage_institutions'),
  ('platform_admin','platform:manage_subscriptions'),
  ('platform_admin','platform:settings_read'),
  ('platform_admin','platform:settings_manage'),
  ('platform_admin','platform:impersonate'),
  ('platform_admin','platform:rbac_read'),
  ('platform_admin','platform:permissions_read'),
  ('platform_admin','backup:read'),
  ('platform_admin','backup:create'),
  ('platform_admin','backup:download'),
  ('platform_admin','jobs:read'),
  ('platform_admin','observability:read'),
  ('platform_admin','observability:metrics'),
  ('platform_admin','observability:health'),
  -- Support Operator: read + support sessions.
  ('support_operator','platform:read'),
  ('support_operator','platform:usage_read'),
  ('support_operator','platform:audit_read'),
  ('support_operator','platform:impersonate'),
  ('support_operator','observability:read'),
  -- Billing Admin: the billing surface (invoices/subscriptions/coupons/packages
  -- all gate on platform:manage_subscriptions today) + reads.
  ('billing_admin','platform:read'),
  ('billing_admin','platform:usage_read'),
  ('billing_admin','platform:manage_subscriptions'),
  -- Read-only Auditor: reads + audit + observability, no mutation.
  ('auditor','platform:read'),
  ('auditor','platform:usage_read'),
  ('auditor','platform:health_read'),
  ('auditor','platform:audit_read'),
  ('auditor','platform:rbac_read'),
  ('auditor','platform:permissions_read'),
  ('auditor','observability:read'),
  -- Technical Admin: health/jobs/backups/observability.
  ('technical_admin','platform:read'),
  ('technical_admin','platform:health_read'),
  ('technical_admin','backup:read'),
  ('technical_admin','backup:create'),
  ('technical_admin','backup:download'),
  ('technical_admin','backup:restore'),
  ('technical_admin','backup:manage'),
  ('technical_admin','jobs:read'),
  ('technical_admin','jobs:manage'),
  ('technical_admin','jobs:retry'),
  ('technical_admin','jobs:cancel'),
  ('technical_admin','jobs:run_scheduler'),
  ('technical_admin','observability:read'),
  ('technical_admin','observability:metrics'),
  ('technical_admin','observability:health'),
  ('technical_admin','observability:logs')
) AS v(role, key)
JOIN permissions p ON p.key = v.key
ON CONFLICT (role, permission_id) DO NOTHING;

-- 4. Relax the platform_role CHECK from 0092 so CUSTOM role keys can be assigned.
--    Values are validated in the service against rbac_roles.key; the 6 built-ins
--    seeded above keep every existing value valid.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_platform_role_check;
