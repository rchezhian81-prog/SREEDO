-- Soft-delete support for students.
--
-- The DELETE /students/:id endpoint now archives a student (status = 'archived')
-- instead of removing the row, so attendance, invoices and payments are no longer
-- cascade-deleted. A true hard delete is still available but gated behind
-- ?hard=true on the endpoint. Archived students are hidden from the default list
-- and from the attendance roster (which already filters status = 'active').

ALTER TABLE students DROP CONSTRAINT students_status_check;
ALTER TABLE students ADD CONSTRAINT students_status_check
  CHECK (status IN ('active', 'inactive', 'graduated', 'transferred', 'archived'));
