-- Live Classes: schedule virtual sessions with a provider join link (Zoom /
-- Meet / Teams / Jitsi). Mode-agnostic — `subject` and free-text `target` fit
-- a school's class/section or a college's program/semester equally.

CREATE TABLE live_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT,
  target TEXT,
  provider TEXT NOT NULL DEFAULT 'meet',
  join_url TEXT NOT NULL,
  host_name TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT live_classes_provider_chk
    CHECK (provider IN ('zoom', 'meet', 'teams', 'jitsi', 'other')),
  CONSTRAINT live_classes_status_chk
    CHECK (status IN ('scheduled', 'live', 'completed', 'cancelled'))
);

CREATE INDEX live_classes_lookup_idx
  ON live_classes(institution_id, scheduled_at DESC);
