-- Parent/Student portal (Phase C): link guardian (parent) user accounts to the
-- students they may view. A student's own login is via students.user_id; this
-- table adds the many-to-many parent⇄child relationship. Tenant-scoped.

CREATE TABLE guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'guardian',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, student_id)
);

CREATE INDEX guardians_user_idx ON guardians(institution_id, user_id);
CREATE INDEX guardians_student_idx ON guardians(institution_id, student_id);
