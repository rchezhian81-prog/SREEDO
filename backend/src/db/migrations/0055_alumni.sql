-- Alumni & Placement directory (GAP-M10): a registry of an institution's
-- graduated students with their current employment / placement details. A row
-- may optionally link back to the original student record.

CREATE TABLE alumni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  batch_year INTEGER NOT NULL,
  email TEXT,
  phone TEXT,
  current_company TEXT,
  designation TEXT,
  location TEXT,
  higher_education TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alumni_institution_batch_idx ON alumni(institution_id, batch_year DESC);
