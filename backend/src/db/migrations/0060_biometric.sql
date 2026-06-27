-- Biometric / RFID attendance (GAP-M13): registered devices push scan events
-- (authenticated by a per-device key). An event is resolved to a student by
-- their admission number and, for an 'in' scan, marks the student present.

CREATE TABLE biometric_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  device_key TEXT NOT NULL UNIQUE,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX biometric_devices_institution_idx ON biometric_devices(institution_id);

CREATE TABLE biometric_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES biometric_devices(id) ON DELETE CASCADE,
  identifier TEXT NOT NULL,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL DEFAULT 'in' CHECK (event_type IN ('in', 'out')),
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX biometric_events_inst_time_idx ON biometric_events(institution_id, event_time DESC);
