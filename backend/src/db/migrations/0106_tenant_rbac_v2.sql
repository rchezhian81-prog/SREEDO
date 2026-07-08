-- 0106_tenant_rbac_v2.sql
-- PR-T2 — Tenant RBAC v2: per-tenant role permission overrides + audit.
--
-- Additive & idempotent. It does NOT touch the global `role_permissions` table's
-- existing rows (that table is platform-managed and shared) — it only:
--   1. adds new tenant permission keys to the global `permissions` catalogue,
--   2. seeds behaviour-preserving DEFAULT grants for those new keys (so migrating
--      the corresponding routes from authorize(...) to requirePermission(...)
--      changes nothing for existing roles),
--   3. creates a NEW institution-scoped override table `tenant_role_permissions`
--      (a tenant with zero rows resolves to exactly the global defaults), and
--   4. creates a `tenant_rbac_audit` trail.
-- No destructive DDL, no data loss.

-- 1. New tenant permission keys (catalogue) --------------------------------
INSERT INTO permissions (key, description) VALUES
  ('students:create',        'Enroll a student'),
  ('students:update',        'Edit a student'),
  ('students:delete',        'Archive / delete a student'),
  ('students:import',        'Bulk-import students'),
  ('students:promote',       'Promote / graduate students'),
  ('teachers:manage',        'Add / edit / remove teachers'),
  ('attendance:mark',        'Mark / edit student attendance'),
  ('exams:manage',           'Create / edit exams'),
  ('exams:enter_marks',      'Enter / edit exam marks'),
  ('tenant_rbac:read',       'View tenant roles & permission matrix'),
  ('tenant_rbac:manage',     'Edit tenant role permissions & reset roles')
ON CONFLICT (key) DO NOTHING;

-- 2. Behaviour-preserving default grants -----------------------------------
-- admin keeps everything it did before (these routes were authorize("admin")).
INSERT INTO role_permissions (role, permission_id)
SELECT 'admin', p.id FROM permissions p
WHERE p.key IN (
  'students:create','students:update','students:delete','students:import','students:promote',
  'teachers:manage','attendance:mark','exams:manage','exams:enter_marks',
  'tenant_rbac:read','tenant_rbac:manage'
)
ON CONFLICT (role, permission_id) DO NOTHING;

-- teacher keeps the two actions that were authorize("admin","teacher").
INSERT INTO role_permissions (role, permission_id)
SELECT 'teacher', p.id FROM permissions p
WHERE p.key IN ('attendance:mark','exams:enter_marks')
ON CONFLICT (role, permission_id) DO NOTHING;

-- 3. Per-tenant override table ---------------------------------------------
-- effect='grant' adds a key on top of the role's global default; effect='deny'
-- removes one. A tenant with no rows here == the global defaults (zero drift).
CREATE TABLE IF NOT EXISTS tenant_role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT 'grant' CHECK (effect IN ('grant', 'deny')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, role, permission_key)
);

CREATE INDEX IF NOT EXISTS tenant_role_permissions_inst_role_idx
  ON tenant_role_permissions (institution_id, role);

-- updated_at trigger (CREATE TRIGGER is not idempotent — drop first).
DROP TRIGGER IF EXISTS tenant_role_permissions_set_updated_at ON tenant_role_permissions;
CREATE TRIGGER tenant_role_permissions_set_updated_at
  BEFORE UPDATE ON tenant_role_permissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. Tenant RBAC audit trail -----------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_rbac_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_role TEXT,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  before JSONB,
  after JSONB,
  reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_rbac_audit_inst_time_idx
  ON tenant_rbac_audit (institution_id, created_at DESC);
