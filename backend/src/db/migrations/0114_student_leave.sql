-- PR-T9 — Student Leave Management (Module 23). Net-new, additive only.
-- Staff leave (leave_requests / staffleave) is untouched; this is a SEPARATE
-- student-facing model. On approval the service marks the student 'excused' in
-- daily attendance via the existing tenant-guarded upsert (no attendance_records
-- schema change). Per-tenant institution_id scoping + in-tenant FK from day one.

-- 1) Permission catalogue -----------------------------------------------------
INSERT INTO permissions (key, description) VALUES
  ('student_leave:read',    'View student leave requests'),
  ('student_leave:create',  'File a student leave request'),
  ('student_leave:approve', 'Approve or reject student leave requests')
ON CONFLICT (key) DO NOTHING;

-- Coarse roles that pass enforcement for non-job-role users.
INSERT INTO role_permissions (role, permission_id)
SELECT 'admin', p.id FROM permissions p
WHERE p.key IN ('student_leave:read', 'student_leave:create', 'student_leave:approve')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'teacher', p.id FROM permissions p
WHERE p.key IN ('student_leave:read', 'student_leave:create', 'student_leave:approve')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Finer job-roles (belt-and-suspenders; tenant-rbac.job-roles.ts is authoritative
-- for jr_* and is updated to match).
INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_principal', p.id FROM permissions p
WHERE p.key IN ('student_leave:read', 'student_leave:create', 'student_leave:approve')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_class_teacher', p.id FROM permissions p
WHERE p.key IN ('student_leave:read', 'student_leave:create', 'student_leave:approve')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_attendance_officer', p.id FROM permissions p
WHERE p.key IN ('student_leave:read', 'student_leave:create', 'student_leave:approve')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_academic_coordinator', p.id FROM permissions p
WHERE p.key IN ('student_leave:read', 'student_leave:create', 'student_leave:approve')
ON CONFLICT (role, permission_id) DO NOTHING;

-- 2) Student leave requests ----------------------------------------------------
-- Application-only (no balances/accrual). status lifecycle:
--   pending → approved (marks daily attendance 'excused' for the range)
--           → rejected (no attendance change)
--           → cancelled (removes only the 'excused' marks the approval created)
CREATE TABLE IF NOT EXISTS student_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'other'
    CHECK (type IN ('sick', 'casual', 'emergency', 'other')),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_leave_inst_status_idx
  ON student_leave_requests(institution_id, status);
CREATE INDEX IF NOT EXISTS student_leave_inst_student_idx
  ON student_leave_requests(institution_id, student_id);
