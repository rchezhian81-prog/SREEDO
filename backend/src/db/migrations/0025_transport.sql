-- Transport Management (Phase D). All tables tenant-scoped (institution_id).
-- Transport fees reuse the existing invoices table; transport_invoices links the
-- generated invoices back to their route/student for the dues report.

CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  registration_no TEXT NOT NULL,
  type TEXT,
  capacity INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  insurance_expiry DATE,
  fitness_expiry DATE,
  permit_expiry DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, registration_no)
);
CREATE INDEX vehicles_institution_idx ON vehicles(institution_id);

CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  license_number TEXT,
  license_expiry DATE,
  helper_name TEXT,
  helper_phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX drivers_institution_idx ON drivers(institution_id);

CREATE TABLE transport_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code)
);
CREATE INDEX transport_routes_institution_idx ON transport_routes(institution_id);

CREATE TABLE route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stop_order INTEGER NOT NULL DEFAULT 0,
  pickup_time TIME,
  drop_time TIME,
  distance_km NUMERIC(6, 2),
  zone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, route_id, name)
);
CREATE INDEX route_stops_route_idx ON route_stops(institution_id, route_id, stop_order);

-- A student's transport allocation (one active record per student).
CREATE TABLE student_transport (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  stop_id UUID REFERENCES route_stops(id) ON DELETE SET NULL,
  trip_type TEXT NOT NULL DEFAULT 'both' CHECK (trip_type IN ('pickup', 'drop', 'both')),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, student_id)
);
CREATE INDEX student_transport_route_idx ON student_transport(institution_id, route_id, stop_id);

-- Route-level (stop_id NULL) or stop-level transport fee.
CREATE TABLE transport_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  stop_id UUID REFERENCES route_stops(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'term', 'annual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX transport_fees_route_uidx
  ON transport_fees(institution_id, route_id) WHERE stop_id IS NULL;
CREATE UNIQUE INDEX transport_fees_stop_uidx
  ON transport_fees(institution_id, stop_id) WHERE stop_id IS NOT NULL;

-- Daily trip log foundation (one pickup + one drop per route per day).
CREATE TABLE transport_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  trip_date DATE NOT NULL,
  trip_type TEXT NOT NULL CHECK (trip_type IN ('pickup', 'drop')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, route_id, trip_date, trip_type)
);
CREATE INDEX transport_trips_idx ON transport_trips(institution_id, trip_date);

-- Links generated transport-fee invoices back to their route/student/period
-- (idempotent generation + the dues report).
CREATE TABLE transport_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  route_id UUID REFERENCES transport_routes(id) ON DELETE SET NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  period TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, student_id, period)
);
CREATE INDEX transport_invoices_route_idx ON transport_invoices(institution_id, route_id);

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('transport:read', 'View transport masters, routes and allocations'),
  ('transport:create', 'Create transport records (vehicles, drivers, routes, stops)'),
  ('transport:update', 'Update transport records'),
  ('transport:delete', 'Delete transport records'),
  ('transport:allocate', 'Allocate students to routes/stops'),
  ('transport:fees', 'Map transport fees and generate transport invoices'),
  ('transport:reports', 'View/export transport reports');

-- admin: full transport access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('transport:read', 'transport:create', 'transport:update', 'transport:delete',
                'transport:allocate', 'transport:fees', 'transport:reports');

-- teacher: browse routes/allocations + reports
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('transport:read', 'transport:reports');

-- accountant: read + transport fees + reports
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('transport:read', 'transport:fees', 'transport:reports');
