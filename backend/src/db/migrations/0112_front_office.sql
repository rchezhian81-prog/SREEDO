-- PR-T7 — Front-Office unification (Module 18).
-- Additive only: two NEW registers that the front office lacked — a postal /
-- dispatch log and a call register. No destructive DDL, no edits to applied
-- migrations, no fork of the existing visitor/feedback/lost-found tables (those
-- are reused as-is and merely re-surfaced under one hub). RBAC keys already exist
-- (front_office:read / front_office:manage, seeded + granted to admin in 0107),
-- so this migration adds no permissions. Per-tenant scoping (institution_id) and
-- in-tenant FK validation follow the PR-T0 model from day one.

-- 1) Postal / Dispatch register ------------------------------------------------
-- Inbound (received) and outbound (dispatched) mail / courier / parcel tracking.
-- ref_no is an optional per-tenant reference; UNIQUE(institution_id, ref_no)
-- allows many rows with NULL ref_no (Postgres treats NULLs as distinct) while
-- keeping any supplied reference unique within the tenant.
CREATE TABLE IF NOT EXISTS postal_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  item_type TEXT NOT NULL DEFAULT 'letter'
    CHECK (item_type IN ('letter', 'parcel', 'courier', 'speed_post', 'other')),
  ref_no TEXT,
  party_name TEXT NOT NULL,            -- sender (inbound) or recipient (outbound)
  addressee TEXT,                      -- internal to/from whom
  carrier TEXT,                        -- India Post / DTDC / Blue Dart / …
  tracking_no TEXT,
  item_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'dispatched', 'delivered', 'collected')),
  remarks TEXT,
  handled_by UUID REFERENCES teachers(id) ON DELETE SET NULL,   -- staff (incl. non-teaching)
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, ref_no)
);

CREATE INDEX IF NOT EXISTS postal_dispatches_inst_date_idx
  ON postal_dispatches(institution_id, item_date DESC);

-- 2) Call register -------------------------------------------------------------
-- Incoming / outgoing phone-call log with an optional follow-up date.
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  caller_name TEXT NOT NULL,
  phone TEXT,
  purpose TEXT,
  related_to TEXT NOT NULL DEFAULT 'general'
    CHECK (related_to IN ('general', 'admission', 'enquiry', 'complaint', 'fees', 'transport', 'other')),
  follow_up_date DATE,
  notes TEXT,
  handled_by UUID REFERENCES teachers(id) ON DELETE SET NULL,
  call_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_logs_inst_time_idx
  ON call_logs(institution_id, call_time DESC);
