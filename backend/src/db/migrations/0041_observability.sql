-- Phase E Observability — permissions only (no new tables). Structured request
-- logging + metrics counters are in-process; queue/health gauges are queried live.
-- The protected observability endpoints (metrics, detailed health, overview) are
-- super-admin-only platform operations; public /health + /ready (liveness /
-- readiness probes) need no auth and never leak secrets or tenant data.

INSERT INTO permissions (key, description) VALUES
  ('observability:read', 'View the platform observability overview'),
  ('observability:metrics', 'Scrape platform metrics (/observability/metrics)'),
  ('observability:health', 'View detailed platform health'),
  ('observability:logs', 'View platform logs (reserved; logs ship to stdout)');

-- Platform operations role only. (super_admin already bypasses permission checks;
-- the explicit grants document the model and make the gate meaningful for any
-- non-super_admin — no tenant role receives observability:*.)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'super_admin', id FROM permissions WHERE key LIKE 'observability:%';
