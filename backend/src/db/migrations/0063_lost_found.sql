-- Lost & Found register: front-office log of lost and found items and their
-- resolution status.

CREATE TABLE lost_found_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'found' CHECK (type IN ('lost', 'found')),
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'claimed', 'returned', 'closed')),
  reporter_name TEXT,
  reporter_contact TEXT,
  item_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lost_found_institution_idx ON lost_found_items(institution_id, status, item_date DESC);
