-- Student Profile v2: richer demographic + admission fields so the student
-- record is a complete SIS profile. All columns are nullable / additive.

ALTER TABLE students
  ADD COLUMN blood_group TEXT,
  ADD COLUMN nationality TEXT,
  ADD COLUMN religion TEXT,
  ADD COLUMN category TEXT,
  ADD COLUMN national_id TEXT,
  ADD COLUMN admission_date DATE,
  ADD COLUMN roll_number TEXT,
  ADD COLUMN previous_school TEXT,
  ADD COLUMN emergency_contact_name TEXT,
  ADD COLUMN emergency_contact_phone TEXT;
