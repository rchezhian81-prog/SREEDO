-- Homework — optional batch targeting (PR-T3 follow-up). A college homework
-- already targets a semester (0108); this lets it optionally narrow to a single
-- batch within that semester. batch_id is a REFINEMENT of the semester target,
-- never a standalone or school (section) target — enforced by a guard CHECK.
-- Additive + safe: existing homework (semester-wide or school section) has
-- batch_id NULL and is unaffected.

ALTER TABLE homework
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id) ON DELETE CASCADE;

-- A batch may only accompany a semester target. Guarded so a re-apply is a no-op.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'homework_batch_needs_semester_chk'
  ) THEN
    ALTER TABLE homework ADD CONSTRAINT homework_batch_needs_semester_chk
      CHECK (batch_id IS NULL OR semester_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS homework_batch_idx
  ON homework(institution_id, batch_id) WHERE batch_id IS NOT NULL;
