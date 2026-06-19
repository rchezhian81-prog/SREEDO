-- Background Job Queue: a durable, Postgres-backed async job queue + worker.
-- Jobs are claimed atomically with FOR UPDATE SKIP LOCKED (no double-processing,
-- no external broker), retried with exponential backoff, and marked permanently
-- failed after max_attempts. A scheduler tick enqueues due Scheduled Reports so
-- they run automatically (manual runs still work). Tenant-aware: institution_id
-- scopes a job; tenant admins see only their own, super_admin sees all.

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,   -- never stores secrets/tokens
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
  priority INT NOT NULL DEFAULT 0,              -- higher runs first
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),    -- eligibility time (backoff pushes it forward)
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,                                   -- last error message only (no stack/secrets)
  dedupe_key TEXT UNIQUE,                       -- de-duplicates enqueues (e.g. schedule+window)
  institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Claim path: pending jobs that are due, by priority then age.
CREATE INDEX jobs_claim_idx ON jobs(status, run_at, priority DESC);
CREATE INDEX jobs_institution_idx ON jobs(institution_id, created_at DESC);
CREATE INDEX jobs_type_idx ON jobs(type);

CREATE TRIGGER jobs_set_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions (worker/queue administration; tenant staff and portal users are
-- never granted any jobs:* key).
INSERT INTO permissions (key, description) VALUES
  ('jobs:read', 'View background jobs'),
  ('jobs:manage', 'Process the worker / manage jobs'),
  ('jobs:retry', 'Retry a failed job'),
  ('jobs:cancel', 'Cancel a pending job'),
  ('jobs:run_scheduler', 'Run the scheduler tick (enqueue due scheduled reports)');

-- admin (scoped to their own institution at runtime) + super_admin (platform-wide).
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions WHERE key LIKE 'jobs:%';
INSERT INTO role_permissions (role, permission_id)
  SELECT 'super_admin', id FROM permissions WHERE key LIKE 'jobs:%';
