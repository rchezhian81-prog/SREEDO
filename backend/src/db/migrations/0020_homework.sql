-- Homework / Assignments (Phase C): a teacher assigns homework to a section +
-- subject with a due date; students submit (text and/or attachments via the
-- documents table); teachers review/grade. All tenant-scoped.

CREATE TABLE homework (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT,
  due_date DATE,
  max_marks NUMERIC(6, 2),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX homework_section_idx ON homework(institution_id, section_id);
CREATE INDEX homework_created_by_idx ON homework(institution_id, created_by);

CREATE TABLE homework_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  homework_id UUID NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'reviewed', 'completed', 'late', 'resubmit')),
  marks NUMERIC(6, 2),
  remarks TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (homework_id, student_id)
);
CREATE INDEX homework_submissions_hw_idx ON homework_submissions(institution_id, homework_id);
CREATE INDEX homework_submissions_student_idx ON homework_submissions(institution_id, student_id);

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('homework:read', 'View homework/assignments'),
  ('homework:create', 'Create homework'),
  ('homework:update', 'Edit homework'),
  ('homework:delete', 'Delete homework'),
  ('homework:submit', 'Submit homework'),
  ('homework:review', 'Review/grade submissions');

-- admin: full
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('homework:read', 'homework:create', 'homework:update',
                'homework:delete', 'homework:submit', 'homework:review');

-- teacher: manage + review (not submit)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('homework:read', 'homework:create', 'homework:update',
                'homework:delete', 'homework:review');

-- accountant: read-only
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions WHERE key = 'homework:read';

-- student: read + submit
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions WHERE key IN ('homework:read', 'homework:submit');

-- parent: read their child's
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions WHERE key = 'homework:read';
