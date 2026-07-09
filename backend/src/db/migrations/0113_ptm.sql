-- PR-T8 — PTM / Parent Meetings (Module 21). Net-new, additive only.
-- A dedicated PTM model (deliberately NOT overloading calendar_events): meetings
-- carry an audience (section/class/semester/batch/all_parents, reusing the exact
-- communication resolveAudience contract), teachers offer bookable slots, parents
-- book a slot for a linked child, and the teacher records attendance + notes.
-- Per-tenant institution_id scoping + in-tenant FK validation from day one.

-- 1) Permission catalogue -----------------------------------------------------
INSERT INTO permissions (key, description) VALUES
  ('ptm:read',   'View parent-teacher meetings, slots and bookings'),
  ('ptm:manage', 'Schedule PTMs, manage slots, record attendance and send invites')
ON CONFLICT (key) DO NOTHING;

-- Grant to the coarse roles that pass enforcement for non-job-role users. Admin
-- and teacher both organise/host PTMs.
INSERT INTO role_permissions (role, permission_id)
SELECT 'admin', p.id FROM permissions p WHERE p.key IN ('ptm:read', 'ptm:manage')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'teacher', p.id FROM permissions p WHERE p.key IN ('ptm:read', 'ptm:manage')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Finer job-roles (belt-and-suspenders; tenant-rbac.job-roles.ts is authoritative
-- for jr_* and is updated to match).
INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_principal', p.id FROM permissions p WHERE p.key IN ('ptm:read', 'ptm:manage')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_academic_coordinator', p.id FROM permissions p WHERE p.key IN ('ptm:read', 'ptm:manage')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'jr_class_teacher', p.id FROM permissions p WHERE p.key IN ('ptm:read', 'ptm:manage')
ON CONFLICT (role, permission_id) DO NOTHING;

-- 2) Meetings -----------------------------------------------------------------
-- audience_type mirrors communication.resolveAudience; audience_ref is the target
-- id (NULL for all_parents), validated in-tenant by the service on create.
CREATE TABLE IF NOT EXISTS ptm_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  meeting_date DATE NOT NULL,
  venue TEXT,
  mode TEXT NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person', 'online')),
  join_link TEXT,
  audience_type TEXT NOT NULL DEFAULT 'all_parents'
    CHECK (audience_type IN ('all_parents', 'section', 'class', 'semester', 'batch')),
  audience_ref UUID,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'completed', 'cancelled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ptm_meetings_inst_date_idx
  ON ptm_meetings(institution_id, meeting_date DESC);

-- 3) Slots --------------------------------------------------------------------
-- A bookable window with a specific teacher; availability = capacity − active bookings.
CREATE TABLE IF NOT EXISTS ptm_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES ptm_meetings(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ptm_slots_meeting_idx
  ON ptm_slots(institution_id, meeting_id, starts_at);

-- 4) Bookings -----------------------------------------------------------------
-- One student per slot at most (UNIQUE); capacity is additionally enforced in a
-- transaction. parent_user_id records who booked (NULL when staff booked on behalf).
CREATE TABLE IF NOT EXISTS ptm_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES ptm_meetings(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES ptm_slots(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'attended', 'no_show', 'cancelled')),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slot_id, student_id)
);

CREATE INDEX IF NOT EXISTS ptm_bookings_meeting_idx
  ON ptm_bookings(institution_id, meeting_id);
CREATE INDEX IF NOT EXISTS ptm_bookings_slot_idx
  ON ptm_bookings(slot_id);
