-- Health / Infirmary records (GAP-M09): a clinic visit log. Each row is one visit;
-- it may optionally link to a student record.

CREATE TABLE infirmary_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL,
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  complaint TEXT,
  treatment TEXT,
  temperature TEXT,
  remarks TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX infirmary_visits_institution_date_idx
  ON infirmary_visits(institution_id, visit_date DESC);
