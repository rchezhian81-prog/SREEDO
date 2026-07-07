-- Super Admin M — Background Jobs Console / Queue Governance.
--
-- Additive + idempotent. Extends the existing job queue (0040_jobs) with the
-- OPERATIONS layer the console needs: an append-only per-attempt history, a
-- dead-letter state (widened status CHECK + reason), a worker heartbeat table
-- (populated from this migration forward — no faked history), plus granular
-- RBAC perms and query indexes. NO destructive DDL and NO job history is ever
-- hard-deleted. Job ALERTS reuse the Observability (L) `alerts` table filtered
-- to job/worker/scheduler types — no duplicate alert store here.

-- 1) Dead-letter state + a few operational columns on the existing jobs table.
--    Widening the status CHECK (drop-if-exists + re-add) is the one accepted
--    schema-widening; it only adds a value, never removes one.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled', 'dead_letter'));

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS queue TEXT;                 -- optional logical queue (NULL → grouped by type)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT;   -- short + safe (masked; no secrets)

-- Operational query indexes (status/type/institution already exist from 0040).
CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(queue);
CREATE INDEX IF NOT EXISTS jobs_locked_by_idx ON jobs(locked_by);
CREATE INDEX IF NOT EXISTS jobs_completed_idx ON jobs(completed_at DESC);
CREATE INDEX IF NOT EXISTS jobs_run_at_idx ON jobs(run_at);

-- 2) Append-only per-attempt history. One row is written per processing attempt
--    (success / retry / failure / dead-letter). NEVER updated in place, so the
--    full timeline of a job is inspectable. `error` is masked (no stack/secrets).
CREATE TABLE IF NOT EXISTS job_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed', 'retry', 'cancelled', 'dead_letter')),
  worker_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  error TEXT,                            -- masked, short (no stack, no secrets)
  retry_reason TEXT,
  backoff_ms INT,
  next_retry_at TIMESTAMPTZ,
  result_summary TEXT,                   -- masked short summary (no payload secrets)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_attempts_job_idx ON job_attempts(job_id, attempt_number);
CREATE INDEX IF NOT EXISTS job_attempts_status_idx ON job_attempts(status);

-- 3) Worker heartbeats. The queue worker is on-demand (no resident broker); each
--    processing run upserts its heartbeat here from this migration forward. Uptime
--    is derived from real heartbeats only — never fabricated.
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('online', 'offline', 'degraded', 'unknown')),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_job_id UUID,
  jobs_processed BIGINT NOT NULL DEFAULT 0,
  jobs_failed BIGINT NOT NULL DEFAULT 0,
  queue TEXT,
  hostname TEXT,                         -- short + safe (no private network detail)
  version TEXT,                          -- app version / commit if available
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_heartbeats_seen_idx ON worker_heartbeats(last_heartbeat_at DESC);

DROP TRIGGER IF EXISTS worker_heartbeats_set_updated_at ON worker_heartbeats;
CREATE TRIGGER worker_heartbeats_set_updated_at
  BEFORE UPDATE ON worker_heartbeats FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4) RBAC — granular jobs-ops perms (base jobs:read/manage/retry/cancel/run_scheduler
--    already exist from 0040). Additive; granted to super_admin + technical_admin
--    (broad ops), with auditor read-only.
INSERT INTO permissions (key, description)
SELECT v.key, v.description FROM (VALUES
  ('jobs:dead_letter',      'Move a failed job to the dead-letter queue'),
  ('jobs:requeue',          'Requeue a job from the dead-letter queue'),
  ('jobs:bulk',             'Perform bulk retry / cancel / dead-letter actions'),
  ('jobs:workers_read',     'View worker status / heartbeats'),
  ('jobs:scheduler_read',   'View the scheduler manager'),
  ('jobs:scheduler_manage', 'Pause / resume / run recurring schedules'),
  ('jobs:alerts_read',      'View job alerts'),
  ('jobs:alerts_manage',    'Acknowledge / resolve job alerts'),
  ('jobs:export',           'Export jobs (CSV / XLSX)'),
  ('jobs:reports_read',     'View job reports')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = v.key);

-- super_admin gets every jobs perm (base + new).
INSERT INTO role_permissions (role, permission_id)
SELECT 'super_admin', p.id FROM permissions p
WHERE p.key LIKE 'jobs:%'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role='super_admin' AND rp.permission_id = p.id);

-- Technical Admin — broad background-jobs operations (all jobs perms). Only when
-- the platform role is actually in use.
INSERT INTO role_permissions (role, permission_id)
SELECT 'technical_admin', p.id FROM permissions p
WHERE p.key LIKE 'jobs:%'
  AND EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = 'technical_admin')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role='technical_admin' AND rp.permission_id = p.id);

-- Auditor — read-only across the jobs console (view, never mutate).
INSERT INTO role_permissions (role, permission_id)
SELECT 'auditor', p.id FROM permissions p
WHERE p.key IN ('jobs:read', 'jobs:workers_read', 'jobs:scheduler_read', 'jobs:alerts_read', 'jobs:reports_read')
  AND EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = 'auditor')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role='auditor' AND rp.permission_id = p.id);
