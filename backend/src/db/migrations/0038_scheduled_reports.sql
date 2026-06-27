-- Scheduled Reports: automated delivery of a saved Custom Report definition on a
-- daily/weekly/monthly cadence, plus on-demand manual runs. Every run is recorded
-- in scheduled_report_runs (an audit history). Generation reuses the Custom Report
-- service, so the underlying report's own permission is ALWAYS enforced (a schedule
-- can never deliver data its actor/recipients couldn't otherwise see). Tenant-scoped.
--
-- report_id is ON DELETE SET NULL (not CASCADE): if the saved report is deleted the
-- schedule survives but its runs fail cleanly until it's repointed/removed.

CREATE TABLE scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  report_id UUID REFERENCES custom_reports(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  run_time TEXT NOT NULL DEFAULT '06:00',     -- HH:MM (interpreted in `timezone`)
  timezone TEXT NOT NULL DEFAULT 'UTC',
  day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6),    -- weekly (0=Sun)
  day_of_month INT CHECK (day_of_month BETWEEN 1 AND 31), -- monthly
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,          -- array of user UUIDs
  channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,    -- in_app | email
  export_format TEXT NOT NULL DEFAULT 'pdf'
    CHECK (export_format IN ('csv', 'pdf', 'both')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_reports_institution_idx ON scheduled_reports(institution_id, created_at);
CREATE INDEX scheduled_reports_due_idx ON scheduled_reports(institution_id, enabled, next_run_at);

-- Run history / audit trail (one row per manual or scheduled execution).
CREATE TABLE scheduled_report_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES scheduled_reports(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped')),
  trigger TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger IN ('manual', 'scheduled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  export_format TEXT,
  export_bytes INT,            -- size of the generated export (file-reference proxy)
  row_count INT,
  recipient_count INT NOT NULL DEFAULT 0,
  delivery_status TEXT,        -- e.g. "in_app: 2; email: dispatched"
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_report_runs_schedule_idx ON scheduled_report_runs(schedule_id, created_at DESC);

CREATE TRIGGER scheduled_reports_set_updated_at
  BEFORE UPDATE ON scheduled_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions
INSERT INTO permissions (key, description) VALUES
  ('scheduled_reports:read', 'View scheduled report definitions'),
  ('scheduled_reports:create', 'Create scheduled reports'),
  ('scheduled_reports:update', 'Edit / enable / disable scheduled reports'),
  ('scheduled_reports:delete', 'Delete scheduled reports'),
  ('scheduled_reports:run', 'Run a scheduled report manually'),
  ('scheduled_reports:history', 'View scheduled report run history'),
  ('scheduled_reports:manage', 'Process due schedules (run the scheduler)');

-- admin: full control
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions WHERE key LIKE 'scheduled_reports:%';

-- accountant: full schedule lifecycle + manual run + history, but NOT manage
-- (running the scheduler is an admin/system concern)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions WHERE key IN (
    'scheduled_reports:read', 'scheduled_reports:create', 'scheduled_reports:update',
    'scheduled_reports:delete', 'scheduled_reports:run', 'scheduled_reports:history'
  );

-- teacher: schedule + run their own reports + history (no delete/manage)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions WHERE key IN (
    'scheduled_reports:read', 'scheduled_reports:create',
    'scheduled_reports:run', 'scheduled_reports:history'
  );

-- student & parent: no access to scheduled-report admin features.
