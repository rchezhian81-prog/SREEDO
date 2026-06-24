-- Events & Academic Calendar (GAP-M05): holidays, events, exam dates, meetings.
-- Readable by any tenant user; managed by institution admins.

CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  end_date DATE,
  type TEXT NOT NULL DEFAULT 'event',  -- holiday | event | exam | meeting | other
  all_day BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX calendar_events_institution_date_idx
  ON calendar_events(institution_id, event_date);
