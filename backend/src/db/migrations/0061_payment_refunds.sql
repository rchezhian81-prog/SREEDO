-- Fee refunds (GAP-F02): record a refund against a fee payment. The total
-- refunded for a payment can never exceed the payment amount (enforced in the
-- service inside a transaction).

CREATE TABLE payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reason TEXT,
  method TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash', 'card', 'bank_transfer', 'upi', 'cheque', 'online')),
  refunded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payment_refunds_institution_idx ON payment_refunds(institution_id, refunded_at DESC);
CREATE INDEX payment_refunds_payment_idx ON payment_refunds(payment_id);
