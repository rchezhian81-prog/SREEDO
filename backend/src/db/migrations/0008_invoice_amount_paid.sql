-- Store the paid total on each invoice instead of recomputing it from payments.
-- This makes the paid/outstanding invariant explicit, keeps it correct under the
-- row lock taken in recordPayment, and removes a per-row subquery from listings.

ALTER TABLE invoices
  ADD COLUMN amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);

UPDATE invoices i
  SET amount_paid = COALESCE(
    (SELECT sum(amount) FROM payments WHERE invoice_id = i.id),
    0
  );
