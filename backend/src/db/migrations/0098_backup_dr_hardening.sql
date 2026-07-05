-- Super Admin J — Backup / Restore / Disaster-Recovery hardening.
--
-- Additive + idempotent. Extends `backups` (integrity checksum + verification,
-- archive/soft-delete, run-log summary) and `backup_settings` (offsite intent +
-- last connectivity test, encryption status, failure-alert config, rollback-window
-- guard); adds a restore approval/execution ledger, a DR-guide singleton, new RBAC
-- permissions and indexes.
--
-- No data is destroyed here. The two widened CHECK constraints are dropped and
-- re-added in place only to ADMIT new status/trigger values — existing rows keep
-- their values. Super-admin / platform surface only (no tenant access).

-- 1) backups: SHA-256 integrity checksum + verification metadata, archive
--    (soft-delete — the artifact may go but the metadata row always stays), and a
--    short safe run-log summary. Widen status ('archived') + trigger
--    ('pre_deploy','pre_restore') value sets.
ALTER TABLE backups
  ADD COLUMN IF NOT EXISTS checksum TEXT,
  ADD COLUMN IF NOT EXISTS checksum_algo TEXT NOT NULL DEFAULT 'sha256',
  ADD COLUMN IF NOT EXISTS checksum_status TEXT NOT NULL DEFAULT 'not_verified',
  ADD COLUMN IF NOT EXISTS checksum_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS checksum_verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS logs_summary TEXT;

ALTER TABLE backups DROP CONSTRAINT IF EXISTS backups_status_check;
ALTER TABLE backups ADD CONSTRAINT backups_status_check
  CHECK (status IN ('pending', 'running', 'success', 'failed', 'archived'));

ALTER TABLE backups DROP CONSTRAINT IF EXISTS backups_trigger_check;
ALTER TABLE backups ADD CONSTRAINT backups_trigger_check
  CHECK (trigger IN ('manual', 'scheduled', 'pre_deploy', 'pre_restore'));

ALTER TABLE backups DROP CONSTRAINT IF EXISTS backups_checksum_status_check;
ALTER TABLE backups ADD CONSTRAINT backups_checksum_status_check
  CHECK (checksum_status IN ('not_verified', 'verified', 'failed'));

CREATE INDEX IF NOT EXISTS backups_trigger_idx ON backups(trigger);
CREATE INDEX IF NOT EXISTS backups_created_by_idx ON backups(created_by);
CREATE INDEX IF NOT EXISTS backups_checksum_status_idx ON backups(checksum_status);

-- 2) backup_settings: offsite intent flag + last connectivity-test outcome,
--    encryption status (honest: false = not app-encrypted), failure-alert config,
--    and a rollback-window guard (min latest-successful backups to always keep).
ALTER TABLE backup_settings
  ADD COLUMN IF NOT EXISTS offsite_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_offsite_test_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_offsite_test_ok BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_offsite_test_detail TEXT,
  ADD COLUMN IF NOT EXISTS encryption_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS failure_alert_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alert_emails TEXT,
  ADD COLUMN IF NOT EXISTS retention_min_keep INT NOT NULL DEFAULT 1;

-- 3) Restore approval + execution ledger. A production restore is NEVER one-click:
--    request -> approve (ideally a different approver) -> execute (typed final
--    confirmation + a fresh pre-restore backup + checksum validation). Single-use
--    via consumed_at; every state transition is audited by the service.
CREATE TABLE IF NOT EXISTS restore_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_id UUID NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'full'
    CHECK (scope IN ('full', 'database', 'files', 'config')),
  reason TEXT NOT NULL,
  risk_reason TEXT,
  impact_preview JSONB,               -- snapshot of the read-only preview at request time
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'executed', 'failed')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  consumed_at TIMESTAMPTZ,            -- set when an approved request is spent on execution
  executed_at TIMESTAMPTZ,
  executed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  execution_result TEXT CHECK (execution_result IN ('success', 'failed', 'partial')),
  execution_detail JSONB,
  pre_restore_backup_id UUID REFERENCES backups(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restore_requests_status_idx ON restore_requests(status);
CREATE INDEX IF NOT EXISTS restore_requests_requested_by_idx ON restore_requests(requested_by);
CREATE INDEX IF NOT EXISTS restore_requests_backup_idx ON restore_requests(backup_id);
CREATE INDEX IF NOT EXISTS restore_requests_created_idx ON restore_requests(created_at DESC);

-- 4) Disaster-recovery guide (singleton id=1). Plain operational text only — it must
--    NEVER contain secrets/keys/passwords. Editable by super-admin; carries an owner
--    + last-reviewed date. Seeded with a sensible default.
CREATE TABLE IF NOT EXISTS backup_dr_guide (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  policy_summary TEXT,
  restore_process TEXT,
  approval_process TEXT,
  emergency_instructions TEXT,
  pre_restore_checklist TEXT,
  post_restore_checklist TEXT,
  rollback_guide TEXT,
  owner_name TEXT,
  owner_contact TEXT,
  sop_link TEXT,
  last_reviewed_at TIMESTAMPTZ,
  last_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO backup_dr_guide (id, policy_summary, restore_process, approval_process,
  emergency_instructions, pre_restore_checklist, post_restore_checklist, rollback_guide)
SELECT 1,
  'Automated logical backups run on the configured schedule. Each backup is a consistent point-in-time snapshot, gzip-compressed and checksummed (SHA-256). Backups are retained per the retention policy and stored in S3-compatible object storage when configured, otherwise on the application server disk.',
  'Restores run from a SUCCESS, checksum-VERIFIED, GLOBAL backup whose schema version matches the running application. Always use Restore Preview (read-only) first, then raise a Restore Request. On approval, execution takes a fresh pre-restore backup, re-validates the checksum, and reloads every table inside a single transaction (rolled back on any error).',
  'Every production restore requires a Restore Request approved by a super-admin (ideally NOT the requester), plus a typed final confirmation at execution time. Rejected, cancelled or expired requests can never be executed, and each approval is single-use.',
  E'If the application is down and a restore is required:\n1. Put the platform into maintenance.\n2. Verify the latest successful backup checksum.\n3. Raise and approve a Restore Request.\n4. Execute with the typed confirmation phrase.\n5. Run the post-restore checklist.',
  E'- Target backup is SUCCESS and checksum VERIFIED\n- Backup schema version matches the running app\n- A fresh pre-restore backup will be taken automatically\n- Maintenance window announced to stakeholders',
  E'- Login and core dashboards load\n- Row counts reconcile against the restore preview\n- A fresh backup has been taken\n- Audit + Security logging is recording again',
  E'If a restore produced a bad state, restore again from the automatically-created pre-restore backup (trigger = pre_restore) via the same approved request -> execute flow.'
WHERE NOT EXISTS (SELECT 1 FROM backup_dr_guide WHERE id = 1);

DROP TRIGGER IF EXISTS backup_dr_guide_set_updated_at ON backup_dr_guide;
CREATE TRIGGER backup_dr_guide_set_updated_at
  BEFORE UPDATE ON backup_dr_guide
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5) RBAC — granular backup/restore permissions (additive; super_admin also carries
--    the existing backup:read/create/download/restore/manage from migration 0043).
--    Uses WHERE NOT EXISTS so it is safe regardless of unique-constraint presence.
INSERT INTO permissions (key, description)
SELECT v.key, v.description FROM (VALUES
  ('backup:verify',   'Verify a backup checksum / integrity'),
  ('backup:export',   'Export backup + restore history (CSV / XLSX)'),
  ('backup:archive',  'Archive a backup artifact (metadata is always retained)'),
  ('restore:read',    'View restore requests and restore history'),
  ('restore:request', 'Raise a restore request'),
  ('restore:approve', 'Approve or reject a restore request'),
  ('restore:execute', 'Execute an approved restore')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = v.key);

INSERT INTO role_permissions (role, permission_id)
SELECT 'super_admin', p.id FROM permissions p
WHERE p.key IN ('backup:verify', 'backup:export', 'backup:archive',
                'restore:read', 'restore:request', 'restore:approve', 'restore:execute')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role = 'super_admin' AND rp.permission_id = p.id
  );
