-- Disciplinary Records: a behavioural incident register for school & college
-- students, with a status lifecycle (open → under_review → action_taken →
-- closed, or cancelled) and an audit-friendly action timeline. Tenant-scoped.
-- The register snapshots the student's class/section (school) or program/
-- semester (college) at creation so the record stays a faithful historical
-- account even if the student's placement later changes; student rows are
-- never deleted. Portal visibility for students/parents is OFF by default and
-- gated by an institution feature flag (institutions.settings) PLUS the
-- disciplinary:portal_read permission PLUS owner-scoping.

CREATE TABLE disciplinary_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- snapshots taken at creation
  admission_no TEXT,
  class_name TEXT,
  section_name TEXT,
  program_name TEXT,
  semester_name TEXT,
  incident_date DATE NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description TEXT,
  reported_by TEXT,
  involved_staff TEXT,
  action_taken TEXT,
  follow_up_date DATE,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'action_taken', 'closed', 'cancelled')),
  remarks TEXT,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX disciplinary_records_institution_idx ON disciplinary_records(institution_id, created_at);
CREATE INDEX disciplinary_records_student_idx ON disciplinary_records(student_id);
CREATE INDEX disciplinary_records_status_idx ON disciplinary_records(institution_id, status);

-- Audit-friendly timeline: one row per workflow event (logged, edited, review,
-- action, close, cancel). Records are never silently mutated without a trail.
CREATE TABLE disciplinary_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  record_id UUID NOT NULL REFERENCES disciplinary_records(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  note TEXT,
  from_status TEXT,
  to_status TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX disciplinary_actions_record_idx ON disciplinary_actions(record_id, created_at);

CREATE TRIGGER disciplinary_records_set_updated_at
  BEFORE UPDATE ON disciplinary_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions
INSERT INTO permissions (key, description) VALUES
  ('disciplinary:read', 'View the disciplinary register'),
  ('disciplinary:create', 'Log a disciplinary incident'),
  ('disciplinary:update', 'Edit a disciplinary record'),
  ('disciplinary:delete', 'Cancel or delete a disciplinary record'),
  ('disciplinary:action', 'Record actions / move a record through review'),
  ('disciplinary:close', 'Close a disciplinary record'),
  ('disciplinary:reports', 'View disciplinary reports'),
  ('disciplinary:portal_read', 'View own / linked-child disciplinary records in the portal');

-- admin: full disciplinary control
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions WHERE key LIKE 'disciplinary:%';

-- teacher / class staff: log, edit, record actions, run reports — but NOT
-- close, cancel/delete, and not the portal-read (a student/parent permission)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions WHERE key IN (
    'disciplinary:read', 'disciplinary:create', 'disciplinary:update',
    'disciplinary:action', 'disciplinary:reports'
  );

-- student & parent: portal read of their own / linked child's records, ONLY
-- when the institution has enabled portal visibility (owner-scoped at runtime)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions WHERE key = 'disciplinary:portal_read';
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions WHERE key = 'disciplinary:portal_read';
