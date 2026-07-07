-- Super Admin Q — Help / SOP / Documentation / Module Status Center.
--
-- Additive + idempotent. The Help Center is a READ-ONLY, curated-in-code
-- documentation surface (help articles, SOPs, smoke-test checklists, known
-- limitations, release notes, emergency playbooks, admin onboarding, and a
-- curated module-status register). It stores NO new domain data and rewrites
-- NO completed module. This migration adds only two dedicated RBAC perms so the
-- help surface and the masked/audited snapshot export can be granted + audited
-- independently of the existing platform:* perms. No tables, no indexes, no
-- destructive DDL. (Editable/persisted docs are intentionally not implemented in
-- this module — see the PR's known-limitations; if added later they would gain
-- their own edit/publish/archive perms + a docs table.)

INSERT INTO permissions (key, description)
SELECT v.key, v.description FROM (VALUES
  ('help:read',   'View the platform help center (docs, SOPs, checklists, limitations, release notes, playbooks, module status)'),
  ('help:export', 'Export a help/checklist/module-status snapshot (CSV / JSON, masked, audited)')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = v.key);

-- super_admin gets both.
INSERT INTO role_permissions (role, permission_id)
SELECT 'super_admin', p.id FROM permissions p
WHERE p.key IN ('help:read', 'help:export')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role='super_admin' AND rp.permission_id = p.id);

-- Every platform sub-role may VIEW the help center (an internal operational
-- reference should be readable by the whole platform team). Export stays
-- super_admin-only (it produces a masked platform-wide snapshot → separately
-- granted). Only granted to a role that is actually in use (has ≥1 perm).
INSERT INTO role_permissions (role, permission_id)
SELECT r.role, p.id
FROM (VALUES ('auditor'), ('technical_admin'), ('platform_admin'), ('support_operator'), ('billing_admin')) AS r(role)
JOIN permissions p ON p.key = 'help:read'
WHERE EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = r.role)
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = r.role AND rp.permission_id = p.id);
