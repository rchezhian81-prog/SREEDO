-- Homework — College variant: a homework row targets EITHER a section (school)
-- or a semester (college), mirroring the timetable_entries pattern from 0023.
-- Additive + school-safe: section_id becomes nullable with a "one of" check and a
-- nullable semester_id is added. Existing school homework (section_id set,
-- semester_id null) is unaffected; the shared submissions table needs no change
-- (submissions couple to homework_id + student_id, not to any cohort).

ALTER TABLE homework
  ADD COLUMN IF NOT EXISTS semester_id UUID REFERENCES semesters(id) ON DELETE CASCADE;

ALTER TABLE homework ALTER COLUMN section_id DROP NOT NULL;

-- Exactly-or-at-least one target. Guarded so a re-apply is a no-op (PostgreSQL
-- has no ADD CONSTRAINT IF NOT EXISTS).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'homework_target_chk'
  ) THEN
    ALTER TABLE homework ADD CONSTRAINT homework_target_chk
      CHECK (section_id IS NOT NULL OR semester_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS homework_semester_idx
  ON homework(institution_id, semester_id) WHERE semester_id IS NOT NULL;
