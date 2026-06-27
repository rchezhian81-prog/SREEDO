-- Grading & report cards (Phase B/C): a per-institution grade scale mapping a
-- percentage range to a letter grade + remark, used when rendering report-card
-- and mark-sheet PDFs from existing exam_results.

CREATE TABLE grade_bands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  min_percent NUMERIC(5, 2) NOT NULL CHECK (min_percent >= 0 AND min_percent <= 100),
  max_percent NUMERIC(5, 2) NOT NULL CHECK (max_percent >= 0 AND max_percent <= 100),
  remark TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (max_percent >= min_percent),
  UNIQUE (institution_id, grade)
);

CREATE INDEX grade_bands_institution_idx ON grade_bands(institution_id);

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('reports:read', 'View the reports area and grade scale'),
  ('reports:export', 'Export reports'),
  ('report_cards:read', 'Download a student report card'),
  ('report_cards:generate', 'Manage the grade scale and generate report cards'),
  ('mark_sheets:export', 'Export class/section mark sheets');

-- admin & teacher: full reporting access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('reports:read', 'reports:export', 'report_cards:read',
                'report_cards:generate', 'mark_sheets:export');
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('reports:read', 'reports:export', 'report_cards:read',
                'report_cards:generate', 'mark_sheets:export');

-- accountant: view the reports area
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions WHERE key IN ('reports:read', 'reports:export');

-- student & parent: download their own / their child's report card
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions WHERE key = 'report_cards:read';
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions WHERE key = 'report_cards:read';
