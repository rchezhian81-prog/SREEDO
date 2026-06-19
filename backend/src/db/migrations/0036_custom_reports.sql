-- Custom Report Builder: saved + ad-hoc report definitions over the existing
-- Reports Center registry. A definition references an existing report key plus
-- selected columns, filters, sorting and a visibility setting. Running a saved
-- report ALSO enforces the underlying report's own permission (checked in code),
-- so a custom report can never widen access. Tenant-scoped.

CREATE TABLE custom_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  report_key TEXT NOT NULL,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,  -- selected column keys; [] = all
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort JSONB,                                  -- { key, dir }
  group_by TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'shared')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX custom_reports_institution_idx ON custom_reports(institution_id, created_at);
CREATE INDEX custom_reports_creator_idx ON custom_reports(institution_id, created_by);

CREATE TRIGGER custom_reports_set_updated_at
  BEFORE UPDATE ON custom_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions
INSERT INTO permissions (key, description) VALUES
  ('custom_reports:read', 'View saved/custom report definitions'),
  ('custom_reports:create', 'Create custom report definitions'),
  ('custom_reports:update', 'Edit custom report definitions'),
  ('custom_reports:delete', 'Delete custom report definitions'),
  ('custom_reports:run', 'Run saved/ad-hoc custom reports'),
  ('custom_reports:export', 'Export custom reports (CSV/PDF)'),
  ('custom_reports:share', 'Share custom reports with other users');

-- admin: full
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions WHERE key LIKE 'custom_reports:%';

-- accountant: build + run + export, but NOT share (sharing stays an admin call)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions WHERE key IN (
    'custom_reports:read', 'custom_reports:create', 'custom_reports:update',
    'custom_reports:delete', 'custom_reports:run', 'custom_reports:export'
  );

-- teacher: run + export shared reports they're allowed to (underlying perm still enforced)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions WHERE key IN (
    'custom_reports:read', 'custom_reports:run', 'custom_reports:export'
  );
