-- Period-wise attendance (GAP-F04): attendance per (student, date, period), in
-- addition to the existing daily attendance. Reuses the attendance_status enum.

CREATE TABLE period_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  period_id UUID NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  status attendance_status NOT NULL,
  marked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, date, period_id)
);

CREATE INDEX period_attendance_lookup_idx
  ON period_attendance(institution_id, date, period_id);
