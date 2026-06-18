-- Multi-tenancy step 1 (non-breaking foundation): add institution_id to the
-- tenant-scoped tables, backfill existing rows to a default institution, and
-- index it. Columns stay NULLABLE and queries are NOT yet scoped here, so this
-- migration changes no behaviour. A follow-up enforces scoping per module and
-- then sets NOT NULL.

INSERT INTO institutions (name, code, type)
  VALUES ('Default Institution', 'DEFAULT', 'school')
  ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  default_id UUID;
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'users', 'students', 'teachers', 'academic_years', 'classes', 'sections',
    'subjects', 'class_subjects', 'attendance_records', 'fee_structures',
    'invoices', 'payments', 'exams', 'exam_results', 'announcements'
  ];
BEGIN
  SELECT id INTO default_id FROM institutions WHERE code = 'DEFAULT';

  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE',
      t
    );
    EXECUTE format(
      'UPDATE %I SET institution_id = $1 WHERE institution_id IS NULL',
      t
    ) USING default_id;
    EXECUTE format(
      'CREATE INDEX %I ON %I(institution_id)',
      t || '_institution_id_idx', t
    );
  END LOOP;
END $$;
