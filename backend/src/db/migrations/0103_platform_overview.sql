-- Super Admin E — Platform Overview Dashboard.
--
-- Additive + idempotent. The Platform Overview is a READ-ONLY aggregation of the
-- already-live module summaries (tenant / invoice / subscription / security /
-- audit / support / backup / export / jobs / observability / communication) —
-- it stores NO new domain data and rewrites NO completed module. This migration
-- adds only two dedicated RBAC perms so the unified overview endpoint and the
-- audited dashboard snapshot export can be granted + audited independently of the
-- existing platform:* perms. No tables, no indexes, no destructive DDL.

INSERT INTO permissions (key, description)
SELECT v.key, v.description FROM (VALUES
  ('overview:read',   'View the platform overview dashboard (aggregated KPIs, trends, attention, status)'),
  ('overview:export', 'Export a platform overview snapshot (CSV / JSON, masked, audited)')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = v.key);

-- super_admin gets both.
INSERT INTO role_permissions (role, permission_id)
SELECT 'super_admin', p.id FROM permissions p
WHERE p.key IN ('overview:read', 'overview:export')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role='super_admin' AND rp.permission_id = p.id);

-- Auditor / technical-admin may VIEW the overview (read-only), never export
-- (export is a masked platform-wide snapshot → separately granted). Only when the
-- platform role is in use.
INSERT INTO role_permissions (role, permission_id)
SELECT r.role, p.id
FROM (VALUES ('auditor'), ('technical_admin')) AS r(role)
JOIN permissions p ON p.key = 'overview:read'
WHERE EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = r.role)
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = r.role AND rp.permission_id = p.id);
