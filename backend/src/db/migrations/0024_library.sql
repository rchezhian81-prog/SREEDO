-- Library Management (Phase D). All tables are tenant-scoped (institution_id).
-- Members reference an existing student or teacher; college students live in the
-- same students table, so no special handling is needed for college mode.

CREATE TABLE book_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);
CREATE INDEX book_categories_institution_idx ON book_categories(institution_id);

CREATE TABLE books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  category_id UUID REFERENCES book_categories(id) ON DELETE SET NULL,
  isbn TEXT,
  title TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  edition TEXT,
  subject TEXT,
  language TEXT,
  rack_location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX books_institution_idx ON books(institution_id);
CREATE INDEX books_title_idx ON books(institution_id, title);

-- Individual physical copies. total/available counts are derived from these.
CREATE TABLE book_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  accession_number TEXT NOT NULL,
  barcode TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'issued', 'lost', 'damaged', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, accession_number)
);
CREATE INDEX book_copies_book_idx ON book_copies(institution_id, book_id);
CREATE INDEX book_copies_status_idx ON book_copies(institution_id, status);

-- Library members: a student or a staff/teacher. Exactly one ref is set.
CREATE TABLE library_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL CHECK (member_type IN ('student', 'staff')),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  member_code TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT library_member_ref_chk CHECK (
    (member_type = 'student' AND student_id IS NOT NULL AND teacher_id IS NULL) OR
    (member_type = 'staff' AND teacher_id IS NOT NULL AND student_id IS NULL)
  )
);
CREATE INDEX library_members_institution_idx ON library_members(institution_id);
CREATE UNIQUE INDEX library_members_student_uidx
  ON library_members(institution_id, student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX library_members_teacher_uidx
  ON library_members(institution_id, teacher_id) WHERE teacher_id IS NOT NULL;

-- Issue / return ledger. Overdue is derived (due_date < today, not returned).
CREATE TABLE book_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  copy_id UUID NOT NULL REFERENCES book_copies(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES library_members(id) ON DELETE CASCADE,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL,
  return_date DATE,
  renewed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'returned', 'lost')),
  fine_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (fine_amount >= 0),
  fine_status TEXT NOT NULL DEFAULT 'none'
    CHECK (fine_status IN ('none', 'pending', 'waived', 'posted')),
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  returned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX book_issues_member_idx ON book_issues(institution_id, member_id);
CREATE INDEX book_issues_copy_idx ON book_issues(institution_id, copy_id);
CREATE INDEX book_issues_open_idx ON book_issues(institution_id, status, due_date);
-- A copy can only be on loan once at a time.
CREATE UNIQUE INDEX book_issues_active_copy_uidx
  ON book_issues(copy_id) WHERE status = 'issued';

-- Per-institution circulation settings (loan period, fine rate, limits).
CREATE TABLE library_settings (
  institution_id UUID PRIMARY KEY REFERENCES institutions(id) ON DELETE CASCADE,
  loan_days INTEGER NOT NULL DEFAULT 14 CHECK (loan_days > 0),
  fine_per_day NUMERIC(10, 2) NOT NULL DEFAULT 1 CHECK (fine_per_day >= 0),
  max_renewals INTEGER NOT NULL DEFAULT 2 CHECK (max_renewals >= 0),
  max_books_per_member INTEGER NOT NULL DEFAULT 3 CHECK (max_books_per_member > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('library:read', 'View the library catalogue, copies and members'),
  ('library:create', 'Create catalogue records (categories, books, copies, members)'),
  ('library:update', 'Update library records and settings'),
  ('library:delete', 'Delete library records'),
  ('library:issue', 'Issue and renew books'),
  ('library:return', 'Return books'),
  ('library:fines', 'Waive or post library fines'),
  ('library:reports', 'View/export library reports');

-- admin: full library access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('library:read', 'library:create', 'library:update', 'library:delete',
                'library:issue', 'library:return', 'library:fines', 'library:reports');

-- teacher: browse the catalogue + reports
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('library:read', 'library:reports');

-- accountant: catalogue read + handle fines + reports
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('library:read', 'library:fines', 'library:reports');
