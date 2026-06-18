-- Race-free admission/employee numbers.
--
-- Previously the next number was derived from count(*)+1, which can hand out the
-- same number to two concurrent inserts. Dedicated sequences are atomic. Each
-- sequence is advanced past any numbers already in use (parsed from the trailing
-- digits of existing values) so generated numbers never collide.

CREATE SEQUENCE IF NOT EXISTS student_admission_seq;
CREATE SEQUENCE IF NOT EXISTS teacher_employee_seq;

DO $$
DECLARE
  max_admission INTEGER;
BEGIN
  SELECT COALESCE(
           MAX(CAST(SUBSTRING(admission_no FROM '[0-9]+$') AS INTEGER)),
           0
         )
    INTO max_admission
    FROM students;
  IF max_admission < 1 THEN
    PERFORM setval('student_admission_seq', 1, false); -- next value = 1
  ELSE
    PERFORM setval('student_admission_seq', max_admission, true); -- next = max+1
  END IF;
END $$;

DO $$
DECLARE
  max_employee INTEGER;
BEGIN
  SELECT COALESCE(
           MAX(CAST(SUBSTRING(employee_no FROM '[0-9]+$') AS INTEGER)),
           0
         )
    INTO max_employee
    FROM teachers;
  IF max_employee < 1 THEN
    PERFORM setval('teacher_employee_seq', 1, false);
  ELSE
    PERFORM setval('teacher_employee_seq', max_employee, true);
  END IF;
END $$;
