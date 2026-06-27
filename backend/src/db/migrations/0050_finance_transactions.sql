-- Accounting / Finance (GAP-M03): a simple income/expense ledger (day-book) for
-- general bookkeeping beyond Fees + Payroll. Each row is one voucher/entry.

CREATE TABLE finance_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  txn_date DATE NOT NULL,
  type TEXT NOT NULL,            -- 'income' | 'expense'
  category TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  description TEXT,
  payment_method TEXT,
  reference_no TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX finance_transactions_institution_date_idx
  ON finance_transactions(institution_id, txn_date DESC);
CREATE INDEX finance_transactions_type_idx
  ON finance_transactions(institution_id, type);
