-- LMS / Study materials (GAP-M07): teachers & admins publish learning resources
-- (links to notes, slides, videos, etc.) scoped to a class and optionally a
-- subject. Students & parents read the materials for their class via the portal.

CREATE TABLE study_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A NULL class_id means the material is shared school-wide.
CREATE INDEX study_materials_institution_class_idx
  ON study_materials(institution_id, class_id);
