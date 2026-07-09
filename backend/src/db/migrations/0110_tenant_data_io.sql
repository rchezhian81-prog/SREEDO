-- PR-T5 — Tenant Import/Export Center (Module 28).
-- Additive only: new RBAC keys + a dedicated import-history model. No destructive
-- DDL, no edits to applied migrations, no re-scoping (that landed in 0105).
--
-- Import history is a first-class model (not audit-only) so operators can review
-- dry-run results and per-row errors, and so committed/failed/cancelled batches
-- are troubleshootable. Action-level audit (dry-run/commit/fail/cancel/export)
-- is emitted separately through the existing audit writer.

-- 1) Permission catalogue -----------------------------------------------------
INSERT INTO permissions (key, description) VALUES
  ('data_io:read',   'View the Import/Export center, templates and import history'),
  ('data_io:import', 'Import tenant data (dry-run + commit)'),
  ('data_io:export', 'Export tenant data (CSV / XLSX)')
ON CONFLICT (key) DO NOTHING;

-- 2) Grant to the coarse admin role (authoritative for admin) ------------------
INSERT INTO role_permissions (role, permission_id)
SELECT 'admin', p.id FROM permissions p
WHERE p.key IN ('data_io:read', 'data_io:import', 'data_io:export')
ON CONFLICT (role, permission_id) DO NOTHING;

-- 3) Grant to finer job-roles (belt-and-suspenders; the code registry in
--    tenant-rbac.job-roles.ts is authoritative for jr_* and is updated to match).
INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_owner_management', p.id FROM permissions p
WHERE p.key IN ('data_io:read', 'data_io:import', 'data_io:export')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_admin_officer', p.id FROM permissions p
WHERE p.key IN ('data_io:read', 'data_io:import', 'data_io:export')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_principal', p.id FROM permissions p
WHERE p.key IN ('data_io:read', 'data_io:export')
ON CONFLICT (role, permission_id) DO NOTHING;

-- 4) Import history model ------------------------------------------------------
-- One row per import operation (dry-run or commit). status lifecycle:
--   dry_run   → validated a file, wrote nothing to domain tables
--   committed → all rows valid, inserted transactionally
--   failed    → commit attempted but aborted (kept for troubleshooting)
--   cancelled → operator abandoned a dry-run
CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  source_filename TEXT,
  status TEXT NOT NULL DEFAULT 'dry_run'
    CHECK (status IN ('dry_run', 'committed', 'failed', 'cancelled')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_batches_inst_created_idx
  ON import_batches(institution_id, created_at DESC);

-- Per-row validation outcome for a batch (reviewable row-level errors).
CREATE TABLE IF NOT EXISTS import_batch_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  valid BOOLEAN NOT NULL,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_batch_rows_batch_idx
  ON import_batch_rows(batch_id, row_number);
