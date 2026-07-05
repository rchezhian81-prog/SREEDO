-- Super Admin L — Health / Observability: Incidents, Alerts, Uptime, Errors.
--
-- Additive + idempotent. Adds the PERSISTENCE layer the observability module has
-- lacked (metrics/health were in-process/live-queried only): incident management
-- (+ timeline), alert rules + an alert feed, service-health/uptime history, and a
-- captured-error store for the error explorer. Plus granular RBAC perms + indexes.
-- Super-admin / platform operations surface only. No data is destroyed here;
-- incident + alert history are never hard-deleted.

-- 1) Incidents (+ an append-only timeline). Never hard-deleted.
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor'
    CHECK (severity IN ('info', 'minor', 'major', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'monitoring', 'resolved', 'closed')),
  type TEXT NOT NULL DEFAULT 'other'
    CHECK (type IN ('api', 'database', 'frontend', 'worker', 'email', 'storage',
                    'backup', 'payment', 'security', 'other')),
  impact TEXT,
  root_cause TEXT,
  resolution TEXT,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  related_alert_id UUID,                 -- FK added after `alerts` exists
  related_audit_id UUID,                 -- a platform_audit_log id (no hard FK)
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents(status);
CREATE INDEX IF NOT EXISTS incidents_severity_idx ON incidents(severity);
CREATE INDEX IF NOT EXISTS incidents_started_idx ON incidents(started_at DESC);

CREATE TABLE IF NOT EXISTS incident_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note'
    CHECK (kind IN ('created', 'status_change', 'severity_change', 'assigned',
                    'note', 'resolved', 'reopened')),
  note TEXT,
  from_status TEXT,
  to_status TEXT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incident_events_incident_idx ON incident_events(incident_id, created_at);

DROP TRIGGER IF EXISTS incidents_set_updated_at ON incidents;
CREATE TRIGGER incidents_set_updated_at
  BEFORE UPDATE ON incidents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2) Alert rules.
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'api_down', 'db_down', 'mongo_down', 'worker_down', 'scheduler_stalled',
    'queue_depth_high', 'job_failure_spike', 'error_rate_high', 'latency_high',
    'smtp_failures', 'storage_high', 'backup_failed', 'gateway_degraded',
    'disk_low', 'memory_high', 'security_event')),
  threshold NUMERIC,
  window_minutes INT NOT NULL DEFAULT 5 CHECK (window_minutes >= 1),
  severity TEXT NOT NULL DEFAULT 'major'
    CHECK (severity IN ('info', 'minor', 'major', 'critical')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  notify_target TEXT,                    -- e.g. an email; NULL = dashboard-only
  cooldown_minutes INT NOT NULL DEFAULT 30 CHECK (cooldown_minutes >= 0),
  last_triggered_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_rules_enabled_idx ON alert_rules(enabled);

DROP TRIGGER IF EXISTS alert_rules_set_updated_at ON alert_rules;
CREATE TRIGGER alert_rules_set_updated_at
  BEFORE UPDATE ON alert_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3) Alert feed / history. Never hard-deleted.
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  rule_name TEXT,
  type TEXT,
  severity TEXT NOT NULL DEFAULT 'major'
    CHECK (severity IN ('info', 'minor', 'major', 'critical')),
  status TEXT NOT NULL DEFAULT 'triggered'
    CHECK (status IN ('triggered', 'acknowledged', 'resolved', 'suppressed')),
  service TEXT,
  metric_value NUMERIC,
  threshold NUMERIC,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  note TEXT,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_status_idx ON alerts(status);
CREATE INDEX IF NOT EXISTS alerts_severity_idx ON alerts(severity);
CREATE INDEX IF NOT EXISTS alerts_triggered_idx ON alerts(triggered_at DESC);

-- Now that alerts exists, link incidents.related_alert_id → alerts(id).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'incidents_related_alert_fk') THEN
    ALTER TABLE incidents ADD CONSTRAINT incidents_related_alert_fk
      FOREIGN KEY (related_alert_id) REFERENCES alerts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4) Service-health / uptime history (append-only, prunable). Populated by the
--    health-check sweep; drives uptime %, response times, degraded/down periods.
CREATE TABLE IF NOT EXISTS service_health_history (
  id BIGSERIAL PRIMARY KEY,
  service TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('healthy', 'degraded', 'down', 'unknown')),
  response_time_ms INT,
  detail TEXT,                           -- short + safe (no secrets/connection strings)
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_health_service_idx ON service_health_history(service, checked_at DESC);
CREATE INDEX IF NOT EXISTS service_health_checked_idx ON service_health_history(checked_at DESC);

-- 5) Captured errors (error explorer). Only 4xx/5xx are captured, deduped by a
--    fingerprint (route + status + normalised message) so the table stays bounded.
--    Messages are masked before storage — never any secret/token/credential.
CREATE TABLE IF NOT EXISTS error_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL UNIQUE,
  route TEXT,
  method TEXT,
  status_code INT,
  error_type TEXT,
  message TEXT,                          -- masked
  last_request_id TEXT,
  last_actor_id UUID,
  last_institution_id UUID,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'investigating', 'resolved', 'ignored')),
  count INT NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS error_events_status_code_idx ON error_events(status_code);
CREATE INDEX IF NOT EXISTS error_events_route_idx ON error_events(route);
CREATE INDEX IF NOT EXISTS error_events_triage_idx ON error_events(status);
CREATE INDEX IF NOT EXISTS error_events_last_seen_idx ON error_events(last_seen DESC);

-- 6) RBAC — incident / alert / error / run perms (observability:* already exist
--    from 0041). Additive; granted to super_admin (+ auditor gets read-only).
INSERT INTO permissions (key, description)
SELECT v.key, v.description FROM (VALUES
  ('incident:read',   'View incidents + timeline'),
  ('incident:create', 'Create an incident'),
  ('incident:update', 'Update an incident (status/notes/assignee)'),
  ('incident:resolve','Resolve / reopen an incident'),
  ('alert:read',      'View alert rules + the alert feed'),
  ('alert:manage',    'Create / edit / enable / disable alert rules'),
  ('alert:ack',       'Acknowledge / resolve alerts'),
  ('error:read',      'View the error explorer'),
  ('observability:run','Run / test service health checks')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = v.key);

INSERT INTO role_permissions (role, permission_id)
SELECT 'super_admin', p.id FROM permissions p
WHERE p.key IN ('incident:read','incident:create','incident:update','incident:resolve',
                'alert:read','alert:manage','alert:ack','error:read','observability:run')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role='super_admin' AND rp.permission_id = p.id);

-- Auditor is read-only across the platform — give it the observability read views.
INSERT INTO role_permissions (role, permission_id)
SELECT 'auditor', p.id FROM permissions p
WHERE p.key IN ('observability:read','observability:health','incident:read','alert:read','error:read')
  AND EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = 'auditor')  -- only if the role is in use
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role='auditor' AND rp.permission_id = p.id);
