-- Hostel Management (Phase D). All tables tenant-scoped (institution_id).
-- Hostel fees reuse the existing invoices table; hostel_invoices links generated
-- invoices to their hostel/student for the dues report (idempotent generation).

CREATE TABLE hostels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'boys' CHECK (type IN ('boys', 'girls', 'co_ed', 'staff')),
  address TEXT,
  warden_name TEXT,
  warden_phone TEXT,
  contact_phone TEXT,
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code)
);
CREATE INDEX hostels_institution_idx ON hostels(institution_id);

CREATE TABLE hostel_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  hostel_id UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, hostel_id, name)
);
CREATE INDEX hostel_blocks_hostel_idx ON hostel_blocks(institution_id, hostel_id);

CREATE TABLE hostel_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  hostel_id UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  block_id UUID REFERENCES hostel_blocks(id) ON DELETE SET NULL,
  room_number TEXT NOT NULL,
  floor TEXT,
  room_type TEXT,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 0),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'occupied', 'maintenance', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, hostel_id, room_number)
);
CREATE INDEX hostel_rooms_hostel_idx ON hostel_rooms(institution_id, hostel_id);

-- A student's hostel allocation. One active allocation per student; one active
-- occupant per bed. Room capacity is enforced in the service.
CREATE TABLE hostel_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  hostel_id UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES hostel_rooms(id) ON DELETE CASCADE,
  bed_no TEXT,
  allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  vacate_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'vacated', 'transferred')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hostel_allocations_room_idx ON hostel_allocations(institution_id, room_id);
CREATE INDEX hostel_allocations_student_idx ON hostel_allocations(institution_id, student_id);
CREATE UNIQUE INDEX hostel_allocations_active_student_uidx
  ON hostel_allocations(institution_id, student_id) WHERE status = 'active';
CREATE UNIQUE INDEX hostel_allocations_active_bed_uidx
  ON hostel_allocations(institution_id, room_id, bed_no)
  WHERE status = 'active' AND bed_no IS NOT NULL;

-- Hostel-level (room_type NULL) or room-type-level fee.
CREATE TABLE hostel_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  hostel_id UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  room_type TEXT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'term', 'annual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hostel_fees_hostel_uidx
  ON hostel_fees(institution_id, hostel_id) WHERE room_type IS NULL;
CREATE UNIQUE INDEX hostel_fees_roomtype_uidx
  ON hostel_fees(institution_id, hostel_id, room_type) WHERE room_type IS NOT NULL;

-- Links generated hostel-fee invoices to hostel/student/period.
CREATE TABLE hostel_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  hostel_id UUID REFERENCES hostels(id) ON DELETE SET NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  period TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, student_id, period)
);
CREATE INDEX hostel_invoices_hostel_idx ON hostel_invoices(institution_id, hostel_id);

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('hostel:read', 'View hostels, rooms and allocations'),
  ('hostel:create', 'Create hostel records (hostels, blocks, rooms)'),
  ('hostel:update', 'Update hostel records'),
  ('hostel:delete', 'Delete hostel records'),
  ('hostel:allocate', 'Allocate, transfer and vacate students'),
  ('hostel:fees', 'Map hostel fees and generate hostel invoices'),
  ('hostel:reports', 'View/export hostel reports');

-- admin: full hostel access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('hostel:read', 'hostel:create', 'hostel:update', 'hostel:delete',
                'hostel:allocate', 'hostel:fees', 'hostel:reports');

-- teacher: browse + reports
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('hostel:read', 'hostel:reports');

-- accountant: read + hostel fees + reports
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('hostel:read', 'hostel:fees', 'hostel:reports');
