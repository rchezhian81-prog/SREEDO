-- Transfer Certificates (TC): issuance register + lifecycle (draft/issued/
-- cancelled). Tenant-scoped. TC numbers use a dedicated atomic sequence (like
-- admission/employee numbers, migration 0009) so they never collide. The
-- register snapshots student/dues details so a TC stays a faithful historical
-- record even if the student's data later changes; student rows are never
-- deleted (issuing a TC only flips the student's status to 'transferred').

CREATE SEQUENCE IF NOT EXISTS transfer_certificate_seq;

CREATE TABLE transfer_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  tc_no TEXT NOT NULL UNIQUE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- snapshots taken at creation
  admission_no TEXT,
  class_name TEXT,
  section_name TEXT,
  program_name TEXT,
  semester_name TEXT,
  academic_year TEXT,
  date_of_issue DATE,
  last_attendance_date DATE,
  leaving_reason TEXT,
  conduct TEXT,
  fee_dues_status TEXT,
  library_dues_status TEXT,
  transport_dues_status TEXT,
  hostel_dues_status TEXT,
  dues_override BOOLEAN NOT NULL DEFAULT false,
  dues_override_reason TEXT,
  remarks TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'cancelled')),
  issued_at TIMESTAMPTZ,
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transfer_certificates_institution_idx ON transfer_certificates(institution_id, created_at);
CREATE INDEX transfer_certificates_student_idx ON transfer_certificates(student_id);
CREATE INDEX transfer_certificates_status_idx ON transfer_certificates(institution_id, status);

CREATE TRIGGER transfer_certificates_set_updated_at
  BEFORE UPDATE ON transfer_certificates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions
INSERT INTO permissions (key, description) VALUES
  ('transfer_certificates:read', 'View the transfer-certificate register'),
  ('transfer_certificates:create', 'Create a TC draft'),
  ('transfer_certificates:update', 'Edit a TC draft'),
  ('transfer_certificates:issue', 'Issue a transfer certificate'),
  ('transfer_certificates:cancel', 'Cancel a transfer certificate'),
  ('transfer_certificates:download', 'Download a transfer-certificate PDF'),
  ('transfer_certificates:override_dues', 'Issue a TC despite pending dues');

-- admin: full TC control incl. dues override
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions WHERE key LIKE 'transfer_certificates:%';

-- accountant / office staff: manage + issue + cancel, but NOT dues override
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions WHERE key IN (
    'transfer_certificates:read', 'transfer_certificates:create',
    'transfer_certificates:update', 'transfer_certificates:issue',
    'transfer_certificates:cancel', 'transfer_certificates:download'
  );

-- student & parent: read + download their own / linked child's issued TC (owner-scoped)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions
  WHERE key IN ('transfer_certificates:read', 'transfer_certificates:download');
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions
  WHERE key IN ('transfer_certificates:read', 'transfer_certificates:download');
