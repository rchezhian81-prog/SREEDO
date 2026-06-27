-- Cafeteria / Mess (GAP-M11): a weekly mess menu. One row per menu line for a
-- (day-of-week, meal) slot per institution. Students & parents read it via the
-- portal; admins manage it from the dashboard.

CREATE TABLE mess_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'snacks', 'dinner')),
  items TEXT NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mess_menu_institution_idx
  ON mess_menu_items(institution_id, day_of_week, meal);
