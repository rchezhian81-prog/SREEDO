-- Staff Attendance + Leave (Phase D — Payroll prerequisite). Tenant-scoped.
-- Staff = teachers; a teacher's own login links via teachers.user_id.

CREATE TABLE leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  is_paid BOOLEAN NOT NULL DEFAULT true,
  default_balance NUMERIC(6, 1) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code)
);
CREATE INDEX leave_types_institution_idx ON leave_types(institution_id);

CREATE TABLE leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  balance NUMERIC(6, 1) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, teacher_id, leave_type_id)
);
CREATE INDEX leave_balances_teacher_idx ON leave_balances(institution_id, teacher_id);
CREATE TRIGGER leave_balances_set_updated_at
  BEFORE UPDATE ON leave_balances FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Daily staff attendance (one row per teacher/date). leave_type_id is set when
-- the row originates from an approved leave (drives paid/unpaid payroll split).
CREATE TABLE staff_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'absent', 'half_day', 'leave', 'holiday')),
  check_in TIME,
  check_out TIME,
  late BOOLEAN NOT NULL DEFAULT false,
  early_out BOOLEAN NOT NULL DEFAULT false,
  leave_type_id UUID REFERENCES leave_types(id) ON DELETE SET NULL,
  remarks TEXT,
  marked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, teacher_id, date)
);
CREATE INDEX staff_attendance_teacher_idx ON staff_attendance(institution_id, teacher_id, date);
CREATE INDEX staff_attendance_date_idx ON staff_attendance(institution_id, date);
CREATE TRIGGER staff_attendance_set_updated_at
  BEFORE UPDATE ON staff_attendance FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  leave_type_id UUID REFERENCES leave_types(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days NUMERIC(6, 1) NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX leave_requests_teacher_idx ON leave_requests(institution_id, teacher_id);
CREATE INDEX leave_requests_status_idx ON leave_requests(institution_id, status);
CREATE TRIGGER leave_requests_set_updated_at
  BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('staff_attendance:read', 'View staff attendance'),
  ('staff_attendance:create', 'Mark staff attendance'),
  ('staff_attendance:update', 'Update staff attendance'),
  ('staff_attendance:delete', 'Delete staff attendance'),
  ('leave:read', 'View leave types, balances and requests'),
  ('leave:create', 'Request leave / manage leave types & balances'),
  ('leave:approve', 'Approve leave requests'),
  ('leave:reject', 'Reject leave requests'),
  ('leave:reports', 'View/export staff attendance & leave reports');

-- admin: full staff-attendance + leave access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('staff_attendance:read', 'staff_attendance:create', 'staff_attendance:update',
                'staff_attendance:delete', 'leave:read', 'leave:create', 'leave:approve',
                'leave:reject', 'leave:reports');

-- teacher (staff): view own attendance, view + request own leave
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('staff_attendance:read', 'leave:read', 'leave:create');

-- accountant: read attendance/leave + reports (payroll inputs)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('staff_attendance:read', 'leave:read', 'leave:reports');
