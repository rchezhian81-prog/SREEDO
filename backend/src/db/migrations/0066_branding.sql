-- White-labeling (GAP-X01): per-institution branding. One row per institution
-- (upserted). Readable by any tenant user so the UI can render it; only admins
-- may change it.

CREATE TABLE institution_branding (
  institution_id UUID PRIMARY KEY REFERENCES institutions(id) ON DELETE CASCADE,
  display_name TEXT,
  logo_url TEXT,
  primary_color TEXT,
  tagline TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
