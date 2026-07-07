-- Tenant Hardening T0 — Multi-tenancy correctness.
--
-- ADDITIVE + IDEMPOTENT. Two correctness fixes, no data loss, no destructive
-- table/column drops:
--
--  (A) Re-scope the pre-tenancy GLOBAL uniques to PER-TENANT. Six columns kept a
--      global UNIQUE from before institution_id existed, so two institutions
--      could not both use the same academic-year name, class name, subject code,
--      admission number, employee number, or invoice number. Each global unique
--      is replaced with UNIQUE(institution_id, <col>). This is a RELAXATION:
--      every row that satisfied the stricter global unique already satisfies the
--      per-tenant one, so the ADD can never fail on existing data.
--
--  (B) Per-tenant numbering. The admission/employee numbers came from two GLOBAL
--      sequences (0009), so numbering was shared across tenants. Introduce a
--      per-(institution, kind) counter table, backfilled from each tenant's own
--      existing max trailing number, and switch the services to it. The old
--      global sequences are left in place (harmless, unused) — nothing is dropped.
--
-- No RLS is introduced here (isolation stays application-level); a safety-net RLS
-- pass is future work (see docs/tenant-admin/TENANT-ADMIN-DATA-MODEL.md).

-- ---------------------------------------------------------------------------
-- (A) Re-scope global single-column UNIQUE constraints to per-tenant.
--     Dynamically drops whatever the existing single-column unique is named
--     (Postgres auto-named them "<table>_<col>_key"), then adds the per-tenant
--     constraint. Idempotent: re-running drops the new one first, then re-adds.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pair   RECORD;
  conrec RECORD;
  newname TEXT;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('academic_years', 'name'),
      ('classes',        'name'),
      ('subjects',       'code'),
      ('students',       'admission_no'),
      ('teachers',       'employee_no'),
      ('invoices',       'invoice_no')
    ) AS v(tbl, col)
  LOOP
    -- Drop every single-column UNIQUE constraint on exactly (col).
    FOR conrec IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel     ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = pair.tbl
        AND con.contype = 'u'
        AND con.conkey = (
          SELECT array_agg(a.attnum)
          FROM pg_attribute a
          WHERE a.attrelid = con.conrelid AND a.attname = pair.col
        )
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', pair.tbl, conrec.conname);
    END LOOP;

    -- Add the per-tenant unique (idempotent).
    newname := pair.tbl || '_inst_' || pair.col || '_key';
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', pair.tbl, newname);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (institution_id, %I)',
      pair.tbl, newname, pair.col
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- (B) Per-tenant sequence counters + backfill from each tenant's existing max.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institution_sequences (
  institution_id UUID   NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  kind           TEXT   NOT NULL,
  current_value  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (institution_id, kind)
);

-- Seed student-admission counters from the trailing digits of existing
-- admission_no values, per tenant. GREATEST keeps the migration idempotent and
-- never rewinds a counter that a later boot has already advanced.
INSERT INTO institution_sequences (institution_id, kind, current_value)
SELECT institution_id, 'student_admission',
       COALESCE(MAX(CAST(SUBSTRING(admission_no FROM '[0-9]+$') AS INTEGER)), 0)
FROM students
WHERE institution_id IS NOT NULL
GROUP BY institution_id
ON CONFLICT (institution_id, kind)
  DO UPDATE SET current_value = GREATEST(institution_sequences.current_value, EXCLUDED.current_value);

INSERT INTO institution_sequences (institution_id, kind, current_value)
SELECT institution_id, 'teacher_employee',
       COALESCE(MAX(CAST(SUBSTRING(employee_no FROM '[0-9]+$') AS INTEGER)), 0)
FROM teachers
WHERE institution_id IS NOT NULL
GROUP BY institution_id
ON CONFLICT (institution_id, kind)
  DO UPDATE SET current_value = GREATEST(institution_sequences.current_value, EXCLUDED.current_value);
