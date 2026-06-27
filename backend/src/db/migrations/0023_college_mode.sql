-- College Mode (Phase B): a college academic structure parallel to the school
-- one, used when institutions.type = 'college'. All new tables are tenant-scoped.
-- Changes to existing tables are ADDITIVE (nullable columns) so the school flow
-- is unaffected.

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  head_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code)
);
CREATE INDEX departments_institution_idx ON departments(institution_id);

CREATE TABLE programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  duration_semesters INTEGER NOT NULL DEFAULT 6,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code)
);
CREATE INDEX programs_institution_idx ON programs(institution_id, department_id);

CREATE TABLE batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_year INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, program_id, name)
);
CREATE INDEX batches_program_idx ON batches(institution_id, program_id);

CREATE TABLE semesters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  number INTEGER NOT NULL,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, program_id, number)
);
CREATE INDEX semesters_program_idx ON semesters(institution_id, program_id);

-- Subjects mapped to a program + (optionally) a specific semester, with credits.
CREATE TABLE program_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  semester_id UUID REFERENCES semesters(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  credits NUMERIC(4, 1) NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, semester_id, subject_id)
);
CREATE INDEX program_subjects_idx ON program_subjects(institution_id, program_id, semester_id);

-- A student's enrollment into a program (+ current semester / batch).
CREATE TABLE enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  semester_id UUID REFERENCES semesters(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES batches(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, student_id, program_id)
);
CREATE INDEX enrollments_program_idx ON enrollments(institution_id, program_id, semester_id);
CREATE INDEX enrollments_student_idx ON enrollments(institution_id, student_id);

-- Staff/teacher allocation to a department / program / subject.
CREATE TABLE staff_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX staff_allocations_idx ON staff_allocations(institution_id, teacher_id);

-- Additive, school-safe extensions to existing tables (all nullable).
ALTER TABLE exams ADD COLUMN semester_id UUID REFERENCES semesters(id) ON DELETE SET NULL;
ALTER TABLE fee_structures ADD COLUMN program_id UUID REFERENCES programs(id) ON DELETE SET NULL;
ALTER TABLE fee_structures ADD COLUMN semester_id UUID REFERENCES semesters(id) ON DELETE SET NULL;
ALTER TABLE grade_bands ADD COLUMN grade_point NUMERIC(3, 1);

-- College timetable: a timetable entry targets either a section (school) or a
-- semester (college). section_id becomes nullable with a "one of" check.
ALTER TABLE timetable_entries ADD COLUMN semester_id UUID REFERENCES semesters(id) ON DELETE CASCADE;
ALTER TABLE timetable_entries ALTER COLUMN section_id DROP NOT NULL;
ALTER TABLE timetable_entries
  ADD CONSTRAINT timetable_target_chk CHECK (section_id IS NOT NULL OR semester_id IS NOT NULL);
CREATE UNIQUE INDEX timetable_semester_slot_uidx
  ON timetable_entries (institution_id, semester_id, day_of_week, period_id)
  WHERE semester_id IS NOT NULL;

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('college:read', 'View college structure'),
  ('college:create', 'Create college records (batches, subjects, enrollments, allocations)'),
  ('college:update', 'Update college records'),
  ('college:delete', 'Delete college records'),
  ('departments:read', 'View departments'),
  ('departments:create', 'Create departments'),
  ('programs:read', 'View programs/courses'),
  ('programs:create', 'Create programs/courses'),
  ('semesters:read', 'View semesters'),
  ('semesters:create', 'Create semesters');

-- admin: full college access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('college:read', 'college:create', 'college:update', 'college:delete',
                'departments:read', 'departments:create', 'programs:read',
                'programs:create', 'semesters:read', 'semesters:create');

-- teacher & accountant: read the college structure
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('college:read', 'departments:read', 'programs:read', 'semesters:read');
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('college:read', 'departments:read', 'programs:read', 'semesters:read');
