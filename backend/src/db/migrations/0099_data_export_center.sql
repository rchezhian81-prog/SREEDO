-- Super Admin K — Data Export Center.
--
-- Additive + idempotent. Adds a governed, artifact-based platform export system:
-- `platform_exports` (the export artifact + its governance: reason, approval,
-- checksum, manifest, expiry, download tracking, soft-archive), `export_schedules`
-- (recurring exports), an `export_settings` singleton (retention defaults), granular
-- `export:*` RBAC permissions, and indexes.
--
-- Leaves the legacy per-tenant `data_exports` summary table (migration 0030)
-- untouched. Super-admin / platform surface only. No data is destroyed here.

-- 1) The governed export artifact.
CREATE TABLE IF NOT EXISTS platform_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN (
    'institutions', 'platform_admins', 'tenant_users', 'invoices', 'subscriptions',
    'packages', 'coupons', 'payments', 'audit_logs', 'security_reports',
    'support_history', 'backup_metadata', 'documents_metadata',
    'students', 'staff', 'fees', 'attendance', 'exams', 'portability_pack'
  )),
  format TEXT NOT NULL CHECK (format IN ('csv', 'xlsx', 'json', 'zip')),
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  sensitive BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'expired', 'cancelled')),
  -- Approval workflow (folded onto the row; at most one approval per export).
  approval_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (approval_status IN ('not_required', 'pending', 'approved', 'rejected', 'cancelled', 'expired')),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  approval_reason TEXT,
  -- Artifact. storage_key is INTERNAL and never returned by the API.
  storage_key TEXT,
  storage_mode TEXT CHECK (storage_mode IN ('s3', 'local')),
  size_bytes BIGINT,
  row_count INT,
  file_count INT,
  checksum TEXT,
  checksum_algo TEXT NOT NULL DEFAULT 'sha256',
  manifest JSONB,
  error TEXT,
  expires_at TIMESTAMPTZ,
  download_count INT NOT NULL DEFAULT 0,
  last_downloaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_downloaded_at TIMESTAMPTZ,
  -- Soft-archive: artifact removed, metadata row ALWAYS retained (never hard-deleted).
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES users(id) ON DELETE SET NULL,
  archive_reason TEXT,
  schedule_id UUID,                    -- set when produced by a schedule (FK added below)
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_exports_status_idx ON platform_exports(status);
CREATE INDEX IF NOT EXISTS platform_exports_scope_idx ON platform_exports(scope);
CREATE INDEX IF NOT EXISTS platform_exports_created_idx ON platform_exports(created_at DESC);
CREATE INDEX IF NOT EXISTS platform_exports_created_by_idx ON platform_exports(requested_by);
CREATE INDEX IF NOT EXISTS platform_exports_expires_idx ON platform_exports(expires_at);
CREATE INDEX IF NOT EXISTS platform_exports_approval_idx ON platform_exports(approval_status);

-- 2) Recurring/scheduled exports.
CREATE TABLE IF NOT EXISTS export_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv', 'xlsx', 'json', 'zip')),
  institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  run_time TEXT NOT NULL DEFAULT '03:00',   -- HH:MM (UTC)
  enabled BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  last_export_id UUID REFERENCES platform_exports(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS export_schedules_enabled_idx ON export_schedules(enabled, next_run_at);

-- Link a produced export back to its schedule (added after both tables exist).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'platform_exports_schedule_fk'
  ) THEN
    ALTER TABLE platform_exports
      ADD CONSTRAINT platform_exports_schedule_fk
      FOREIGN KEY (schedule_id) REFERENCES export_schedules(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP TRIGGER IF EXISTS export_schedules_set_updated_at ON export_schedules;
CREATE TRIGGER export_schedules_set_updated_at
  BEFORE UPDATE ON export_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3) Retention defaults (singleton). Sensitive exports expire sooner.
CREATE TABLE IF NOT EXISTS export_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_retention_days INT NOT NULL DEFAULT 7 CHECK (default_retention_days >= 1),
  sensitive_retention_days INT NOT NULL DEFAULT 2 CHECK (sensitive_retention_days >= 1),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO export_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS export_settings_set_updated_at ON export_settings;
CREATE TRIGGER export_settings_set_updated_at
  BEFORE UPDATE ON export_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4) RBAC — granular export permissions (additive; super_admin gets all).
INSERT INTO permissions (key, description)
SELECT v.key, v.description FROM (VALUES
  ('export:read',        'View the Data Export Center + export history'),
  ('export:create',      'Create a data export'),
  ('export:download',    'Download an export artifact'),
  ('export:cancel',      'Cancel a pending/running export'),
  ('export:approve',     'Approve or reject a high-risk export request'),
  ('export:schedule',    'Manage scheduled exports'),
  ('export:retention',   'Manage export retention + archive artifacts'),
  ('export:sensitive',   'Create sensitive/high-risk-scope exports (audit/security/support/admins)'),
  ('export:portability', 'Generate a full tenant data-portability pack')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = v.key);

INSERT INTO role_permissions (role, permission_id)
SELECT 'super_admin', p.id FROM permissions p
WHERE p.key IN ('export:read', 'export:create', 'export:download', 'export:cancel',
                'export:approve', 'export:schedule', 'export:retention',
                'export:sensitive', 'export:portability')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role = 'super_admin' AND rp.permission_id = p.id
  );
