-- PR-T6 — Staff Master (non-teaching). Additive only.
--
-- `teachers` is the de-facto staff table (payroll, staff attendance, leave,
-- timetable, homeroom, class-subjects, departments, staff-allocations all FK
-- teachers.id). Rather than fork a parallel table (which would break those),
-- we add a staff-type discriminator so non-teaching staff live in the same
-- table and reuse the existing HR wiring. Existing rows backfill to 'teaching'
-- so every current teacher/faculty flow is unchanged.

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS staff_type TEXT NOT NULL DEFAULT 'teaching'
    CHECK (staff_type IN ('teaching', 'non_teaching')),
  ADD COLUMN IF NOT EXISTS designation TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT;

-- Existing rows are teaching staff (the DEFAULT already sets this for the
-- backfill; explicit UPDATE is a belt-and-suspenders no-op for clarity).
UPDATE teachers SET staff_type = 'teaching' WHERE staff_type IS NULL;

CREATE INDEX IF NOT EXISTS teachers_inst_staff_type_idx
  ON teachers(institution_id, staff_type);
