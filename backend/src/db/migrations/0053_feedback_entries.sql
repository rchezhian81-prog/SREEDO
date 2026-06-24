-- Feedback / Surveys / Grievance (GAP-M12): a complaint & suggestion tracker with
-- a resolution workflow. Entries can be logged by an admin or submitted publicly.

CREATE TABLE feedback_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'feedback',  -- feedback | complaint | suggestion | grievance
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  submitter_name TEXT,
  submitter_contact TEXT,
  status TEXT NOT NULL DEFAULT 'open',     -- open | in_progress | resolved | closed
  resolution TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX feedback_entries_institution_idx
  ON feedback_entries(institution_id, status);
