-- Reports Center (Phase C): read-only cross-module reports + CSV/PDF export.
-- No new tables — reports run over existing data. Permissions only.

INSERT INTO permissions (key, description) VALUES
  ('reports:center:read', 'View the reports center'),
  ('reports:center:export', 'Export reports (CSV/PDF)'),
  ('reports:attendance:read', 'View attendance reports'),
  ('reports:fees:read', 'View fee reports'),
  ('reports:exams:read', 'View exam reports'),
  ('reports:homework:read', 'View homework reports');

-- admin: all reports
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('reports:center:read', 'reports:center:export', 'reports:attendance:read',
                'reports:fees:read', 'reports:exams:read', 'reports:homework:read');

-- accountant: general + fees
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('reports:center:read', 'reports:center:export', 'reports:fees:read');

-- teacher: general + attendance/exams/homework (not fees)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('reports:center:read', 'reports:center:export', 'reports:attendance:read',
                'reports:exams:read', 'reports:homework:read');

-- student & parent: no access to admin reports.
