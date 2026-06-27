-- Online Fee Gateway: pluggable hosted-checkout payments against existing invoices.
-- No card/bank/UPI data is ever stored — only non-sensitive provider order/payment
-- references. Provider + secrets come from environment variables (never hardcoded
-- or committed). Per-institution enablement is a feature flag in
-- institutions.settings; when the gateway is unconfigured the system degrades
-- gracefully and offline fee collection keeps working unchanged.

CREATE TABLE payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  order_no TEXT NOT NULL UNIQUE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'pending', 'success', 'failed', 'cancelled', 'expired', 'refunded')),
  provider TEXT NOT NULL,
  gateway_ref TEXT,            -- provider order id (not sensitive)
  gateway_payment_id TEXT,     -- provider payment id on success (not sensitive)
  refund_ref TEXT,             -- provider refund id (not sensitive)
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL, -- fee receipt created on success
  checkout_url TEXT,           -- hosted checkout / payment link
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payment_orders_institution_idx ON payment_orders(institution_id, created_at);
CREATE INDEX payment_orders_invoice_idx ON payment_orders(invoice_id);
CREATE INDEX payment_orders_student_idx ON payment_orders(student_id);
CREATE INDEX payment_orders_status_idx ON payment_orders(status);
-- A given provider order reference maps to exactly one order (webhook lookup key).
CREATE UNIQUE INDEX payment_orders_provider_ref_idx
  ON payment_orders(provider, gateway_ref) WHERE gateway_ref IS NOT NULL;

CREATE TRIGGER payment_orders_set_updated_at
  BEFORE UPDATE ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Webhook idempotency + audit trail (metadata only — never raw payloads/secrets).
CREATE TABLE payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  payment_order_id UUID REFERENCES payment_orders(id) ON DELETE SET NULL,
  status TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

-- Permissions
INSERT INTO permissions (key, description) VALUES
  ('online_payments:read', 'View online payment orders & status'),
  ('online_payments:create', 'Initiate an online payment for an invoice'),
  ('online_payments:refund', 'Initiate online payment refunds'),
  ('online_payments:reports', 'View online payment reports'),
  ('online_payments:settings', 'View/manage online payment gateway settings');

-- admin: full online-payments access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions WHERE key LIKE 'online_payments:%';

-- accountant: read/create/refund/reports (settings is an admin concern)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('online_payments:read', 'online_payments:create',
                'online_payments:refund', 'online_payments:reports');

-- student & parent: read + create only (owner-scoped to own/linked invoices in code)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions
  WHERE key IN ('online_payments:read', 'online_payments:create');
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions
  WHERE key IN ('online_payments:read', 'online_payments:create');
