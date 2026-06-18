-- Granular permission layer: module:action permissions granted per role.
--
-- This complements the coarse authorize(...roles) gate. Routes migrate to
-- requirePermission('module:action') incrementally; the seeded matrix mirrors
-- the current role gates so behaviour is preserved. super_admin bypasses these
-- checks in code (platform god role). The catalogue is reference data seeded
-- here so every environment has it.

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (role, permission_id)
);

CREATE INDEX role_permissions_role_idx ON role_permissions(role);

INSERT INTO permissions (key, description) VALUES
  ('dashboard:view', 'View dashboard KPIs'),
  ('students:read', 'View students'),
  ('students:create', 'Enroll students'),
  ('students:update', 'Edit students'),
  ('students:delete', 'Archive/delete students'),
  ('teachers:read', 'View teachers'),
  ('teachers:create', 'Add teachers'),
  ('teachers:update', 'Edit teachers'),
  ('teachers:delete', 'Remove teachers'),
  ('academics:read', 'View academic structure'),
  ('academics:manage', 'Manage years/classes/sections/subjects'),
  ('attendance:read', 'View attendance'),
  ('attendance:mark', 'Mark attendance'),
  ('exams:read', 'View exams and results'),
  ('exams:manage', 'Create exams and enter results'),
  ('fees:read', 'View fees and invoices'),
  ('fees:manage', 'Manage fee structures, invoices and payments'),
  ('fees:summary', 'View fee collection summary'),
  ('announcements:read', 'View announcements'),
  ('announcements:manage', 'Publish announcements'),
  ('users:manage', 'Manage user accounts'),
  ('ai:use', 'Use the AI assistant'),
  ('reports:view', 'View reports');

-- admin: full school-level access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions;

-- teacher
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions WHERE key IN (
    'dashboard:view', 'students:read', 'teachers:read', 'academics:read',
    'attendance:read', 'attendance:mark', 'exams:read', 'exams:manage',
    'fees:read', 'announcements:read', 'announcements:manage', 'ai:use',
    'reports:view'
  );

-- accountant
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions WHERE key IN (
    'dashboard:view', 'students:read', 'academics:read', 'fees:read',
    'fees:manage', 'fees:summary', 'announcements:read', 'ai:use',
    'reports:view'
  );

-- student (own records via owner-scoping)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions WHERE key IN (
    'students:read', 'attendance:read', 'exams:read', 'fees:read',
    'announcements:read'
  );

-- parent (children's records via owner-scoping, once linked)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions WHERE key IN (
    'students:read', 'attendance:read', 'exams:read', 'fees:read',
    'announcements:read'
  );
