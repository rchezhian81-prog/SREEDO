-- PR-SEC1 — Teacher own-class row scoping. Additive, idempotent, permissions-only:
-- no tables, no indexes, no destructive DDL.
--
-- One new permission: academics:all_sections — the broad-view bypass. A staff
-- member WITHOUT it (a plain teacher, or the class_teacher / subject_teacher
-- job-roles) is limited to the students and sections they own for attendance,
-- period attendance, exam marks and homework once ENFORCE_TEACHER_SCOPE is turned
-- on (school mode only in this release; college scoping is a documented
-- fast-follow).
--
-- Granted here to the coarse `admin` role. Oversight job-roles
-- (jr_owner_management, jr_principal, jr_academic_coordinator, jr_admin_officer)
-- inherit it in code via the Academic Setup registry group; jr_exam_controller
-- and jr_attendance_officer carry it explicitly (institution-wide operational
-- roles). The coarse `teacher` role is deliberately NOT granted, so plain
-- teachers are scoped. super_admin (platform) always bypasses.
--
-- This grant alone changes NOTHING in production: enforcement is gated behind the
-- OFF-by-default ENFORCE_TEACHER_SCOPE kill-switch, so a deploy is a behavioural
-- no-op until an operator turns it on for a school whose teacher→section data is
-- confirmed populated.

INSERT INTO permissions (key, description) VALUES
  ('academics:all_sections', 'Access all classes/sections (bypass teacher own-class row scoping)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'admin', p.id FROM permissions p
WHERE p.key = 'academics:all_sections'
ON CONFLICT (role, permission_id) DO NOTHING;
