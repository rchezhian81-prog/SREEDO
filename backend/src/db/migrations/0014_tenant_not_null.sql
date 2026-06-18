-- Multi-tenancy step 2: enforce institution_id on school data tables.
--
-- Backfills any remaining NULLs to the default institution (validation safety
-- net) and then sets institution_id NOT NULL. users.institution_id stays
-- NULLABLE on purpose — super_admin is cross-tenant (no single institution).

DO $$
DECLARE
  default_id UUID;
  t TEXT;
  remaining BIGINT;
  tenant_tables TEXT[] := ARRAY[
    'students', 'teachers', 'academic_years', 'classes', 'sections',
    'subjects', 'class_subjects', 'attendance_records', 'fee_structures',
    'invoices', 'payments', 'exams', 'exam_results', 'announcements'
  ];
BEGIN
  SELECT id INTO default_id FROM institutions WHERE code = 'DEFAULT';
  IF default_id IS NULL THEN
    INSERT INTO institutions (name, code, type)
      VALUES ('Default Institution', 'DEFAULT', 'school')
      RETURNING id INTO default_id;
  END IF;

  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format(
      'UPDATE %I SET institution_id = $1 WHERE institution_id IS NULL', t
    ) USING default_id;

    EXECUTE format(
      'SELECT count(*) FROM %I WHERE institution_id IS NULL', t
    ) INTO remaining;
    IF remaining > 0 THEN
      RAISE EXCEPTION 'Backfill validation failed: % rows in % still have NULL institution_id', remaining, t;
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN institution_id SET NOT NULL', t);
  END LOOP;
END $$;
