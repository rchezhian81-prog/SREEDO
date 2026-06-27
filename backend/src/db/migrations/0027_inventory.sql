-- Inventory Management (Phase D). All tables tenant-scoped (institution_id).
-- current_stock on inventory_items is the authoritative running balance, updated
-- transactionally with every movement; stock_movements is the audit ledger
-- (one row per stock change, with the resulting balance).

CREATE TABLE item_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);
CREATE INDEX item_categories_institution_idx ON item_categories(institution_id);

CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  gst_number TEXT,
  address TEXT,
  payment_terms TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);
CREATE INDEX vendors_institution_idx ON vendors(institution_id);

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  category_id UUID REFERENCES item_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  unit TEXT,
  opening_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
  current_stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
  min_stock_level NUMERIC(12, 2) NOT NULL DEFAULT 0,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code)
);
CREATE INDEX inventory_items_institution_idx ON inventory_items(institution_id);

-- Purchase (stock-in) header + line items.
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  bill_no TEXT,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX purchases_institution_idx ON purchases(institution_id, purchase_date);

CREATE TABLE purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  rate NUMERIC(12, 2) NOT NULL DEFAULT 0,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX purchase_items_purchase_idx ON purchase_items(institution_id, purchase_id);

-- Stock issue (stock-out).
CREATE TABLE stock_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
  issued_to_type TEXT NOT NULL DEFAULT 'department'
    CHECK (issued_to_type IN ('department', 'staff', 'student', 'event', 'other')),
  issued_to TEXT,
  purpose TEXT,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  received_by TEXT,
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_issues_item_idx ON stock_issues(institution_id, item_id);

-- Stock adjustment (damage / lost / correction). quantity is a signed delta.
CREATE TABLE stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(12, 2) NOT NULL CHECK (quantity <> 0),
  reason TEXT NOT NULL DEFAULT 'correction'
    CHECK (reason IN ('damage', 'lost', 'correction')),
  note TEXT,
  approved_by TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_adjustments_item_idx ON stock_adjustments(institution_id, item_id);

-- Unified audit ledger: one row per stock change, with the resulting balance.
CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('opening', 'purchase', 'issue', 'adjustment')),
  change NUMERIC(12, 2) NOT NULL,
  balance_after NUMERIC(12, 2) NOT NULL,
  ref_table TEXT,
  ref_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_item_idx ON stock_movements(institution_id, item_id, created_at);

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('inventory:read', 'View inventory items, vendors and stock'),
  ('inventory:create', 'Create inventory records (categories, items, vendors)'),
  ('inventory:update', 'Update inventory records'),
  ('inventory:delete', 'Delete inventory records'),
  ('inventory:purchase', 'Record purchases (stock in)'),
  ('inventory:issue', 'Issue stock (stock out)'),
  ('inventory:adjust', 'Adjust stock (damage/lost/correction)'),
  ('inventory:reports', 'View/export inventory reports');

-- admin: full inventory access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('inventory:read', 'inventory:create', 'inventory:update', 'inventory:delete',
                'inventory:purchase', 'inventory:issue', 'inventory:adjust', 'inventory:reports');

-- accountant: read + purchases + reports
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('inventory:read', 'inventory:purchase', 'inventory:reports');

-- teacher: read + reports
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('inventory:read', 'inventory:reports');
