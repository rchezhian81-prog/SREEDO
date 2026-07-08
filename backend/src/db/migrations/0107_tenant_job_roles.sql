-- 0107_tenant_job_roles.sql
-- PR-T2.1 — finer, assignable tenant job-roles (Option ①).
--
-- Additive & idempotent. Adds:
--   1. new delegation permission keys (academics / admissions / fees-core /
--      front-office / calendar) + behaviour-preserving default grants for the
--      coarse roles (so the coarse->granular route migration changes nothing),
--   2. a `tenant_roles` registry (19 GLOBAL built-in job-roles seeded here;
--      per-tenant custom roles supported via institution_id), and
--   3. `users.job_role_key` — the optional finer role layered on the coarse role.
-- The 19 job-roles' default permission sets are seeded into the global
-- role_permissions table keyed by the job-role key (generated from the TS
-- registry; enforcement reads role_permissions so there is no runtime drift).
-- No destructive DDL, no data loss. A user with job_role_key = NULL behaves
-- exactly as today (coarse-role resolution).

-- 1. New delegation permission keys ----------------------------------------
INSERT INTO permissions (key, description) VALUES
  ('academic_years:manage', 'Manage academic years'),
  ('classes:manage',        'Manage classes'),
  ('sections:manage',       'Manage sections'),
  ('subjects:manage',       'Manage subjects'),
  ('admissions:read',       'View admissions & enquiries'),
  ('admissions:create',     'Create admission / enquiry'),
  ('admissions:update',     'Edit admission'),
  ('admissions:convert',    'Convert enquiry to student'),
  ('admissions:delete',     'Delete admission'),
  ('fees:manage',           'Create / edit invoices & fee structures'),
  ('fees:payment',          'Record fee payments'),
  ('fees:reverse',          'Reverse / cancel / void a payment'),
  ('front_office:read',     'View visitors / front office'),
  ('front_office:manage',   'Manage visitors / front office'),
  ('calendar:manage',       'Create / edit / delete events'),
  ('announcements:manage',  'Publish announcements')
ON CONFLICT (key) DO NOTHING;

-- 2. Behaviour-preserving coarse-role grants -------------------------------
-- admin previously passed authorize("admin") on all these routes.
INSERT INTO role_permissions (role, permission_id)
SELECT 'admin', p.id FROM permissions p WHERE p.key IN (
  'academic_years:manage','classes:manage','sections:manage','subjects:manage',
  'admissions:read','admissions:create','admissions:update','admissions:convert','admissions:delete',
  'fees:manage','fees:payment','fees:reverse',
  'front_office:read','front_office:manage','calendar:manage','announcements:manage'
) ON CONFLICT (role, permission_id) DO NOTHING;

-- accountant previously passed authorize("admin","accountant") on fees invoice/payment writes.
INSERT INTO role_permissions (role, permission_id)
SELECT 'accountant', p.id FROM permissions p WHERE p.key IN ('fees:manage','fees:payment')
ON CONFLICT (role, permission_id) DO NOTHING;

-- teacher previously passed authorize("admin","teacher") on announcement writes.
INSERT INTO role_permissions (role, permission_id)
SELECT 'teacher', p.id FROM permissions p WHERE p.key IN ('announcements:manage')
ON CONFLICT (role, permission_id) DO NOTHING;

-- 3. Tenant job-role registry ----------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE, -- NULL = global built-in
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_role user_role NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'both' CHECK (applies_to IN ('school', 'college', 'both')),
  is_built_in BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Global built-ins are unique by key; per-tenant custom roles unique by (institution_id, key).
CREATE UNIQUE INDEX IF NOT EXISTS tenant_roles_global_key_idx
  ON tenant_roles (key) WHERE institution_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_roles_tenant_key_idx
  ON tenant_roles (institution_id, key) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tenant_roles_inst_idx ON tenant_roles (institution_id);

DROP TRIGGER IF EXISTS tenant_roles_set_updated_at ON tenant_roles;
CREATE TRIGGER tenant_roles_set_updated_at
  BEFORE UPDATE ON tenant_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. The finer-role column on users ----------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role_key TEXT;
CREATE INDEX IF NOT EXISTS users_job_role_key_idx
  ON users (job_role_key) WHERE job_role_key IS NOT NULL;

-- 5. Seed built-in job-roles + their default permission sets ----------------
-- (generated from src/modules/tenant-rbac/tenant-rbac.job-roles.ts)
INSERT INTO tenant_roles (key, name, description, base_role, applies_to, is_built_in)
VALUES
  ('jr_owner_management', 'Institution Owner / Management', 'Full tenant access — settings, roles, users, and every module.', 'admin', 'both', true),
  ('jr_principal', 'Principal / Head of Institution', 'Broad academic oversight; can view fees and reports. No fee reversal, RBAC or user management by default.', 'admin', 'both', true),
  ('jr_admin_officer', 'Admin Officer', 'Students, admissions, academic setup, documents and front office. Limited finance by default.', 'admin', 'both', true),
  ('jr_academic_coordinator', 'Academic Coordinator', 'Academic setup, timetable, attendance, exams and reports.', 'admin', 'both', true),
  ('jr_admission_officer', 'Admission Officer', 'Admissions and enquiries, student creation, and documents.', 'admin', 'both', true),
  ('jr_fees_officer', 'Fees / Accounts Officer', 'Fees, receipts, payments, dues and finance reports. No fee reversal or academic marks by default.', 'accountant', 'both', true),
  ('jr_exam_controller', 'Exam Controller', 'Exams, marks, results and report cards. No fees or RBAC by default.', 'teacher', 'both', true),
  ('jr_attendance_officer', 'Attendance Officer', 'Attendance marking, editing and reports.', 'teacher', 'both', true),
  ('jr_timetable_coordinator', 'Timetable Coordinator', 'Timetable management and staff-workload views.', 'admin', 'both', true),
  ('jr_hr_admin', 'HR / Staff Admin', 'Staff and teacher profiles, staff attendance, leave and payroll.', 'admin', 'both', true),
  ('jr_hod', 'Department Head / HOD', 'Department, program and semester academic controls (college).', 'teacher', 'college', true),
  ('jr_class_teacher', 'Class Teacher', 'Own class: attendance, homework, basic reports and parent communication.', 'teacher', 'school', true),
  ('jr_subject_teacher', 'Subject Teacher', 'Own subject: attendance, marks and homework.', 'teacher', 'both', true),
  ('jr_front_office', 'Front Office / Reception', 'Enquiries, visitors, basic student lookup and communication intake.', 'admin', 'both', true),
  ('jr_librarian', 'Librarian', 'Library management only.', 'accountant', 'both', true),
  ('jr_transport_manager', 'Transport Manager', 'Transport management only.', 'accountant', 'both', true),
  ('jr_hostel_warden', 'Hostel Warden', 'Hostel management only.', 'accountant', 'both', true),
  ('jr_inventory_manager', 'Inventory Manager', 'Inventory management only.', 'accountant', 'both', true),
  ('jr_auditor', 'Read-only Auditor', 'View-only across modules. No writes; exports only if explicitly granted.', 'accountant', 'both', true)
ON CONFLICT (key) WHERE institution_id IS NULL DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_owner_management', p.id FROM permissions p WHERE p.key IN ('academic_years:manage', 'admissions:convert', 'admissions:create', 'admissions:delete', 'admissions:read', 'admissions:update', 'ai:document_search', 'ai:read', 'ai:risk_alerts', 'ai:summarize', 'ai:workflow_suggestions', 'announcements:manage', 'attendance:mark', 'calendar:manage', 'classes:manage', 'college:create', 'college:delete', 'college:read', 'college:update', 'communication:create', 'communication:delete', 'communication:read', 'communication:send', 'custom_reports:create', 'custom_reports:delete', 'custom_reports:export', 'custom_reports:read', 'custom_reports:run', 'custom_reports:update', 'departments:create', 'departments:read', 'disciplinary:action', 'disciplinary:close', 'disciplinary:create', 'disciplinary:delete', 'disciplinary:read', 'disciplinary:update', 'documents:delete', 'documents:download', 'documents:read', 'documents:upload', 'exams:enter_marks', 'exams:manage', 'fee_categories:create', 'fee_categories:delete', 'fee_categories:read', 'fee_categories:update', 'fee_discounts:apply', 'fee_discounts:approve', 'fee_discounts:read', 'fee_fines:apply', 'fee_fines:read', 'fee_fines:waive', 'fee_receipts:download', 'fee_schedules:create', 'fee_schedules:generate', 'fee_schedules:read', 'fee_schedules:update', 'fees:manage', 'fees:payment', 'fees:reverse', 'front_office:manage', 'front_office:read', 'homework:create', 'homework:delete', 'homework:read', 'homework:review', 'homework:update', 'hostel:allocate', 'hostel:create', 'hostel:delete', 'hostel:fees', 'hostel:read', 'hostel:update', 'id_cards:download', 'id_cards:generate', 'institution:logo:update', 'inventory:adjust', 'inventory:create', 'inventory:delete', 'inventory:issue', 'inventory:purchase', 'inventory:read', 'inventory:update', 'leave:approve', 'leave:create', 'leave:read', 'leave:reject', 'library:create', 'library:delete', 'library:fines', 'library:issue', 'library:read', 'library:return', 'library:update', 'mark_sheets:export', 'notifications:send', 'online_payments:create', 'online_payments:read', 'online_payments:refund', 'online_payments:settings', 'payroll:create', 'payroll:delete', 'payroll:finalize', 'payroll:payslip', 'payroll:read', 'payroll:run', 'payroll:update', 'programs:create', 'programs:read', 'report_cards:generate', 'report_cards:read', 'reports:center:read', 'reports:read', 'scheduled_reports:create', 'scheduled_reports:delete', 'scheduled_reports:history', 'scheduled_reports:manage', 'scheduled_reports:read', 'scheduled_reports:run', 'scheduled_reports:update', 'sections:manage', 'semesters:create', 'semesters:read', 'staff_attendance:create', 'staff_attendance:delete', 'staff_attendance:read', 'staff_attendance:update', 'students:create', 'students:delete', 'students:import', 'students:promote', 'students:update', 'subjects:manage', 'teachers:manage', 'tenant_rbac:manage', 'tenant_rbac:read', 'threads:create', 'threads:delete', 'threads:manage', 'threads:read', 'threads:reply', 'timetable:create', 'timetable:delete', 'timetable:export', 'timetable:read', 'timetable:update', 'transfer_certificates:cancel', 'transfer_certificates:create', 'transfer_certificates:download', 'transfer_certificates:issue', 'transfer_certificates:read', 'transfer_certificates:update', 'transport:allocate', 'transport:create', 'transport:delete', 'transport:fees', 'transport:read', 'transport:update', 'users:manage')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_principal', p.id FROM permissions p WHERE p.key IN ('academic_years:manage', 'admissions:convert', 'admissions:create', 'admissions:delete', 'admissions:read', 'admissions:update', 'ai:document_search', 'ai:read', 'ai:risk_alerts', 'ai:summarize', 'ai:workflow_suggestions', 'announcements:manage', 'attendance:mark', 'calendar:manage', 'classes:manage', 'college:create', 'college:delete', 'college:read', 'college:update', 'communication:create', 'communication:delete', 'communication:read', 'communication:send', 'custom_reports:create', 'custom_reports:delete', 'custom_reports:export', 'custom_reports:read', 'custom_reports:run', 'custom_reports:update', 'departments:create', 'departments:read', 'disciplinary:action', 'disciplinary:close', 'disciplinary:create', 'disciplinary:delete', 'disciplinary:read', 'disciplinary:update', 'documents:delete', 'documents:download', 'documents:read', 'documents:upload', 'exams:enter_marks', 'exams:manage', 'fee_categories:read', 'fee_discounts:read', 'fee_fines:read', 'fee_receipts:download', 'fee_schedules:read', 'homework:create', 'homework:delete', 'homework:read', 'homework:review', 'homework:update', 'id_cards:download', 'id_cards:generate', 'institution:logo:update', 'leave:approve', 'leave:create', 'leave:read', 'leave:reject', 'mark_sheets:export', 'notifications:send', 'online_payments:read', 'payroll:create', 'payroll:delete', 'payroll:finalize', 'payroll:payslip', 'payroll:read', 'payroll:run', 'payroll:update', 'programs:create', 'programs:read', 'report_cards:generate', 'report_cards:read', 'reports:center:read', 'reports:read', 'scheduled_reports:create', 'scheduled_reports:delete', 'scheduled_reports:history', 'scheduled_reports:manage', 'scheduled_reports:read', 'scheduled_reports:run', 'scheduled_reports:update', 'sections:manage', 'semesters:create', 'semesters:read', 'staff_attendance:create', 'staff_attendance:delete', 'staff_attendance:read', 'staff_attendance:update', 'students:create', 'students:delete', 'students:import', 'students:promote', 'students:update', 'subjects:manage', 'teachers:manage', 'threads:create', 'threads:delete', 'threads:manage', 'threads:read', 'threads:reply', 'timetable:create', 'timetable:delete', 'timetable:export', 'timetable:read', 'timetable:update', 'transfer_certificates:cancel', 'transfer_certificates:create', 'transfer_certificates:download', 'transfer_certificates:issue', 'transfer_certificates:read', 'transfer_certificates:update')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_admin_officer', p.id FROM permissions p WHERE p.key IN ('academic_years:manage', 'admissions:convert', 'admissions:create', 'admissions:delete', 'admissions:read', 'admissions:update', 'announcements:manage', 'calendar:manage', 'classes:manage', 'communication:create', 'communication:delete', 'communication:read', 'communication:send', 'documents:delete', 'documents:download', 'documents:read', 'documents:upload', 'front_office:manage', 'front_office:read', 'id_cards:download', 'id_cards:generate', 'institution:logo:update', 'notifications:send', 'sections:manage', 'students:create', 'students:delete', 'students:import', 'students:promote', 'students:update', 'subjects:manage', 'threads:create', 'threads:delete', 'threads:manage', 'threads:read', 'threads:reply', 'timetable:read', 'transfer_certificates:cancel', 'transfer_certificates:create', 'transfer_certificates:download', 'transfer_certificates:issue', 'transfer_certificates:read', 'transfer_certificates:update')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_academic_coordinator', p.id FROM permissions p WHERE p.key IN ('academic_years:manage', 'attendance:mark', 'classes:manage', 'college:create', 'college:delete', 'college:read', 'college:update', 'custom_reports:create', 'custom_reports:delete', 'custom_reports:export', 'custom_reports:read', 'custom_reports:run', 'custom_reports:update', 'departments:create', 'departments:read', 'exams:enter_marks', 'exams:manage', 'homework:create', 'homework:delete', 'homework:read', 'homework:review', 'homework:update', 'mark_sheets:export', 'programs:create', 'programs:read', 'report_cards:generate', 'report_cards:read', 'reports:center:read', 'reports:read', 'scheduled_reports:create', 'scheduled_reports:delete', 'scheduled_reports:history', 'scheduled_reports:manage', 'scheduled_reports:read', 'scheduled_reports:run', 'scheduled_reports:update', 'sections:manage', 'semesters:create', 'semesters:read', 'subjects:manage', 'timetable:create', 'timetable:delete', 'timetable:export', 'timetable:read', 'timetable:update')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_admission_officer', p.id FROM permissions p WHERE p.key IN ('admissions:convert', 'admissions:create', 'admissions:delete', 'admissions:read', 'admissions:update', 'communication:read', 'communication:send', 'documents:read', 'documents:upload', 'students:create', 'students:update')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_fees_officer', p.id FROM permissions p WHERE p.key IN ('fee_categories:create', 'fee_categories:delete', 'fee_categories:read', 'fee_categories:update', 'fee_discounts:apply', 'fee_discounts:approve', 'fee_discounts:read', 'fee_fines:apply', 'fee_fines:read', 'fee_fines:waive', 'fee_receipts:download', 'fee_schedules:create', 'fee_schedules:generate', 'fee_schedules:read', 'fee_schedules:update', 'fees:manage', 'fees:payment', 'online_payments:create', 'online_payments:read', 'online_payments:settings', 'reports:read')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_exam_controller', p.id FROM permissions p WHERE p.key IN ('exams:enter_marks', 'exams:manage', 'mark_sheets:export', 'report_cards:generate', 'report_cards:read', 'timetable:read')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_attendance_officer', p.id FROM permissions p WHERE p.key IN ('attendance:mark', 'reports:read')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_timetable_coordinator', p.id FROM permissions p WHERE p.key IN ('staff_attendance:read', 'timetable:create', 'timetable:delete', 'timetable:export', 'timetable:read', 'timetable:update')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_hr_admin', p.id FROM permissions p WHERE p.key IN ('leave:approve', 'leave:create', 'leave:read', 'leave:reject', 'payroll:create', 'payroll:delete', 'payroll:finalize', 'payroll:payslip', 'payroll:read', 'payroll:run', 'payroll:update', 'staff_attendance:create', 'staff_attendance:delete', 'staff_attendance:read', 'staff_attendance:update', 'teachers:manage')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_hod', p.id FROM permissions p WHERE p.key IN ('attendance:mark', 'college:create', 'college:delete', 'college:read', 'college:update', 'departments:create', 'departments:read', 'exams:enter_marks', 'homework:read', 'programs:create', 'programs:read', 'semesters:create', 'semesters:read', 'timetable:read')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_class_teacher', p.id FROM permissions p WHERE p.key IN ('attendance:mark', 'communication:read', 'communication:send', 'homework:create', 'homework:delete', 'homework:read', 'homework:review', 'homework:update', 'reports:read')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_subject_teacher', p.id FROM permissions p WHERE p.key IN ('attendance:mark', 'exams:enter_marks', 'homework:create', 'homework:delete', 'homework:read', 'homework:review', 'homework:update')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_front_office', p.id FROM permissions p WHERE p.key IN ('admissions:create', 'admissions:read', 'calendar:manage', 'communication:read', 'communication:send', 'front_office:manage', 'front_office:read')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_librarian', p.id FROM permissions p WHERE p.key IN ('library:create', 'library:delete', 'library:fines', 'library:issue', 'library:read', 'library:return', 'library:update')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_transport_manager', p.id FROM permissions p WHERE p.key IN ('transport:allocate', 'transport:create', 'transport:delete', 'transport:fees', 'transport:read', 'transport:update')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_hostel_warden', p.id FROM permissions p WHERE p.key IN ('hostel:allocate', 'hostel:create', 'hostel:delete', 'hostel:fees', 'hostel:read', 'hostel:update')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_inventory_manager', p.id FROM permissions p WHERE p.key IN ('inventory:adjust', 'inventory:create', 'inventory:delete', 'inventory:issue', 'inventory:purchase', 'inventory:read', 'inventory:update')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_auditor', p.id FROM permissions p WHERE p.key IN ('admissions:read', 'ai:read', 'college:read', 'communication:read', 'custom_reports:read', 'departments:read', 'disciplinary:read', 'documents:read', 'fee_categories:read', 'fee_discounts:read', 'fee_fines:read', 'fee_schedules:read', 'front_office:read', 'homework:read', 'hostel:read', 'inventory:read', 'leave:read', 'library:read', 'online_payments:read', 'payroll:read', 'programs:read', 'report_cards:read', 'reports:center:read', 'reports:read', 'scheduled_reports:read', 'semesters:read', 'staff_attendance:read', 'tenant_rbac:read', 'threads:read', 'timetable:read', 'transfer_certificates:read', 'transport:read')
ON CONFLICT (role, permission_id) DO NOTHING;
