-- Library reservations (GAP-F07): a student (via the portal) reserves a book
-- title; the librarian/admin fulfils or cancels the request. One active
-- (pending) reservation per student per book.

CREATE TABLE book_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fulfilled', 'cancelled', 'expired')),
  notes TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX book_reservations_inst_status_idx ON book_reservations(institution_id, status);
CREATE INDEX book_reservations_student_idx ON book_reservations(student_id);

-- A student can hold only one pending reservation for a given book at a time.
CREATE UNIQUE INDEX book_reservations_unique_pending
  ON book_reservations(book_id, student_id) WHERE status = 'pending';
