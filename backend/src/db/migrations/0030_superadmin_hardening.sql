-- Super Admin Hardening (production SaaS controls). Super-admin-only surface.
-- Global institution settings + per-institution feature flags / enabled modules
-- live in institutions.settings (JSONB); audit logs live in MongoDB (best-effort,
-- read by the viewer). This migration adds the data-export history log.

CREATE TABLE data_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'summary' CHECK (kind IN ('summary')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX data_exports_institution_idx ON data_exports(institution_id, created_at);
