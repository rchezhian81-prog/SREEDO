-- The inline guardian on a student record had name/phone/email but no
-- relationship. Add it so the student form can capture Father / Mother /
-- Guardian / Other. (Linked parent-portal accounts already carry a relationship
-- in the `guardians` table; this is for the denormalised inline contact.)

ALTER TABLE students ADD COLUMN guardian_relation TEXT;
