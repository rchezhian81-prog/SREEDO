-- Global User-Role Management (Super Admin RBAC console) — permissions only, no
-- new tables. Reuses the existing permissions + role_permissions catalogue, the
-- runtime permission cache (invalidated on every change), and platform_audit_log
-- for a durable grant/revoke trail. Super-admin platform surface only.

INSERT INTO permissions (key, description) VALUES
  ('platform:rbac_read', 'View the role-permission matrix'),
  ('platform:rbac_manage', 'Grant / revoke role permissions'),
  ('platform:permissions_read', 'View the permission catalogue'),
  ('platform:permissions_manage', 'Manage the permission catalogue (reserved)');

INSERT INTO role_permissions (role, permission_id)
  SELECT 'super_admin', id FROM permissions WHERE key IN (
    'platform:rbac_read', 'platform:rbac_manage',
    'platform:permissions_read', 'platform:permissions_manage'
  );
