-- Timetable Management (Phase B): period & room masters and the per-section
-- timetable grid, all tenant-scoped. Conflict prevention is enforced both in the
-- service (friendly 409s) and by the partial unique indexes below (race-safe).

CREATE TABLE periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_break BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);
CREATE INDEX periods_institution_idx ON periods(institution_id);

CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  capacity INTEGER,
  building TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code)
);
CREATE INDEX rooms_institution_idx ON rooms(institution_id);

CREATE TABLE timetable_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  period_id UUID NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A section can hold only one entry per day+period.
CREATE UNIQUE INDEX timetable_section_slot_uidx
  ON timetable_entries (institution_id, section_id, day_of_week, period_id);
-- A teacher cannot be double-booked into the same day+period.
CREATE UNIQUE INDEX timetable_teacher_slot_uidx
  ON timetable_entries (institution_id, teacher_id, day_of_week, period_id)
  WHERE teacher_id IS NOT NULL;
-- A room cannot be double-booked into the same day+period.
CREATE UNIQUE INDEX timetable_room_slot_uidx
  ON timetable_entries (institution_id, room_id, day_of_week, period_id)
  WHERE room_id IS NOT NULL;

CREATE INDEX timetable_section_idx ON timetable_entries(institution_id, section_id);
CREATE INDEX timetable_teacher_idx ON timetable_entries(institution_id, teacher_id);

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('timetable:read', 'View timetables'),
  ('timetable:create', 'Create timetable entries, periods and rooms'),
  ('timetable:update', 'Edit timetable entries, periods and rooms'),
  ('timetable:delete', 'Delete timetable entries, periods and rooms'),
  ('timetable:export', 'Export/print timetables');

-- admin: full control
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('timetable:read', 'timetable:create', 'timetable:update',
                'timetable:delete', 'timetable:export');

-- teacher: view + print their timetable
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('timetable:read', 'timetable:export');

-- accountant / student / parent: read-only
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions WHERE key = 'timetable:read';
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions WHERE key = 'timetable:read';
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions WHERE key = 'timetable:read';
