-- 0089: Super Admin C-4 — Razorpay payment gateway for platform SaaS invoices.
-- A super-admin-only online-payment flow for operator-issued subscription
-- invoices (saas_invoices). This is SEPARATE from the tenant-side student-fee
-- gateway (payment_orders / payment_webhook_events) — that is left untouched.
-- Secrets live in a singleton settings row and are never returned raw by the API.

-- Singleton gateway configuration (id = TRUE). key_secret / webhook_secret are
-- sensitive and are masked on read; key_id is the (non-secret) checkout key.
CREATE TABLE IF NOT EXISTS saas_payment_gateway_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  provider TEXT NOT NULL DEFAULT 'razorpay',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  key_id TEXT,
  key_secret TEXT,
  webhook_secret TEXT,
  default_currency TEXT NOT NULL DEFAULT 'INR',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO saas_payment_gateway_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- One row per payment attempt / link generated for a SaaS invoice. We keep only
-- non-sensitive provider references (link id, payment id) — never card/UPI data.
CREATE TABLE IF NOT EXISTS saas_payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES saas_invoices(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  gateway_order_id TEXT,        -- Razorpay payment-link id (plink_…) or order id
  gateway_payment_id TEXT,      -- Razorpay payment id (pay_…) once captured
  gateway_reference TEXT,       -- reference_id we send (the invoice number)
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded')),
  payment_link_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_payment_transactions_invoice_idx
  ON saas_payment_transactions(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS saas_payment_transactions_order_idx
  ON saas_payment_transactions(provider, gateway_order_id) WHERE gateway_order_id IS NOT NULL;

-- Inbound webhook idempotency ledger: (provider, event_id) is unique so a
-- replayed/duplicate delivery is processed at most once.
CREATE TABLE IF NOT EXISTS saas_payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  transaction_id UUID REFERENCES saas_payment_transactions(id) ON DELETE SET NULL,
  status TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);
