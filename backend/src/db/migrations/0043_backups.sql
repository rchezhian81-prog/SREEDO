-- Scheduled Backup / Restore Automation (Phase E). Durable metadata for database
-- backups plus a singleton settings row for retention + the automatic schedule.
-- Backup ARTIFACTS live in object storage (S3) or the local-disk fallback (dev);
-- only an internal, app-generated storage key is kept here and it is NEVER exposed
-- through the API. Super-admin / platform surface only (no tenant access).
--
-- A backup is a logical snapshot (per-table to_jsonb rows + sequence values),
-- portable and restorable via json_populate_recordset — no external pg_dump
-- binary required, so it runs identically in CI and on the VPS.

CREATE TABLE backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'global' = whole database (the only restorable kind); 'institution' = a
  -- filtered per-tenant data export (download only).
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'institution')),
  institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'success', 'failed')),
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'scheduled')),
  storage_mode TEXT CHECK (storage_mode IN ('s3', 'local')),
  storage_key TEXT,                 -- internal object key; never returned by the API
  size_bytes BIGINT,
  table_count INT,
  row_count INT,
  schema_version INT,               -- count of applied migrations at backup time
  error TEXT,                       -- short, safe message only (no secrets/stack)
  created_by UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL = system/scheduled
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- scope and institution_id must agree: institution backups carry a tenant id,
  -- global backups never do.
  CONSTRAINT backups_scope_institution_chk
    CHECK ((scope = 'institution') = (institution_id IS NOT NULL))
);
CREATE INDEX backups_created_idx ON backups(created_at DESC);
CREATE INDEX backups_status_idx ON backups(status);
CREATE INDEX backups_scope_idx ON backups(scope, institution_id);

-- Singleton settings row (id is pinned to 1). retention_count NULL means
-- retention is OFF — old backups are NEVER auto-deleted when it is missing.
CREATE TABLE backup_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  retention_count INT CHECK (retention_count IS NULL OR retention_count >= 1),
  schedule_enabled BOOLEAN NOT NULL DEFAULT false,
  schedule_frequency TEXT NOT NULL DEFAULT 'daily'
    CHECK (schedule_frequency IN ('daily', 'weekly', 'monthly')),
  schedule_run_time TEXT NOT NULL DEFAULT '02:00',  -- HH:MM (UTC)
  next_run_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO backup_settings (id) VALUES (1);

CREATE TRIGGER backup_settings_set_updated_at
  BEFORE UPDATE ON backup_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions — super_admin only (the routes also sit behind authorize('super_admin')).
INSERT INTO permissions (key, description) VALUES
  ('backup:read', 'View backups and backup settings'),
  ('backup:create', 'Trigger a manual database backup'),
  ('backup:download', 'Download a backup artifact'),
  ('backup:restore', 'Restore the database from a backup'),
  ('backup:manage', 'Manage retention / schedule settings and delete backups');

INSERT INTO role_permissions (role, permission_id)
  SELECT 'super_admin', id FROM permissions WHERE key LIKE 'backup:%';
