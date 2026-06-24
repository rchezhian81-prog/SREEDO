-- Front Office / Visitor Management (GAP-M04): a visitor check-in / check-out log.

CREATE TABLE visitor_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  visitor_name TEXT NOT NULL,
  phone TEXT,
  purpose TEXT,
  whom_to_meet TEXT,
  badge_no TEXT,
  in_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  out_time TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX visitor_logs_institution_idx
  ON visitor_logs(institution_id, in_time DESC);
