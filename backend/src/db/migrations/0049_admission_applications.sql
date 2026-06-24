-- Online Admissions (GAP-M02): prospective applicants captured BEFORE enrollment.
-- An application moves enquiry -> applied -> under_review -> admitted -> enrolled
-- (or rejected). On enrollment it is linked to the created students row.

CREATE TABLE admission_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  gender TEXT,
  grade_applying TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  guardian_email TEXT,
  address TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'enquiry',
  notes TEXT,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admission_applications_institution_idx
  ON admission_applications(institution_id);
CREATE INDEX admission_applications_status_idx
  ON admission_applications(institution_id, status);
