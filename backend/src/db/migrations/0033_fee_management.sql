-- Fee Management Depth: categories, term schedules, late fines, discounts/
-- scholarships, and dues reporting. Built additively on the existing invoices/
-- payments engine so offline collection and the online gateway keep working
-- unchanged. All tables are tenant-scoped (institution_id).

-- 1. Fee categories (tuition, transport, hostel, exam, library fine, misc, custom)
CREATE TABLE fee_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);
CREATE INDEX fee_categories_institution_idx ON fee_categories(institution_id);

-- 2. Term-wise fee schedules. Targets are optional and combined with AND; all
-- null = every active student. Generation expands the target into invoices.
CREATE TABLE fee_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category_id UUID REFERENCES fee_categories(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  term_type TEXT NOT NULL DEFAULT 'term'
    CHECK (term_type IN ('one_time', 'monthly', 'quarterly', 'term', 'annual')),
  term_label TEXT,
  due_date DATE NOT NULL,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id) ON DELETE CASCADE,
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  semester_id UUID REFERENCES semesters(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fee_schedules_institution_idx ON fee_schedules(institution_id);

-- 3. Augment invoices with category, schedule link and running fine/discount
-- totals. amount_due remains the NET payable (base - discounts + fines), so
-- payments and the online gateway need no changes. base = amount_due +
-- discount_total - fine_total.
ALTER TABLE invoices
  ADD COLUMN category_id UUID REFERENCES fee_categories(id) ON DELETE SET NULL,
  ADD COLUMN fee_schedule_id UUID REFERENCES fee_schedules(id) ON DELETE SET NULL,
  ADD COLUMN discount_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN fine_total NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- Idempotent generation: one invoice per (schedule, student).
CREATE UNIQUE INDEX invoices_schedule_student_idx
  ON invoices(fee_schedule_id, student_id) WHERE fee_schedule_id IS NOT NULL;

-- 4. Late-fine rules.
CREATE TABLE fee_fine_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category_id UUID REFERENCES fee_categories(id) ON DELETE SET NULL,
  fine_type TEXT NOT NULL CHECK (fine_type IN ('fixed', 'per_day', 'percent')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  grace_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fee_fine_rules_institution_idx ON fee_fine_rules(institution_id);

-- Applied fines (audit + waiver). Applying adds to invoices.amount_due/fine_total.
CREATE TABLE invoice_fines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  fine_rule_id UUID REFERENCES fee_fine_rules(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  days INTEGER,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'waived')),
  reason TEXT,
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  waived_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invoice_fines_invoice_idx ON invoice_fines(invoice_id);
CREATE INDEX invoice_fines_institution_idx ON invoice_fines(institution_id);
CREATE TRIGGER invoice_fines_set_updated_at
  BEFORE UPDATE ON invoice_fines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. Discount/scholarship rules.
CREATE TABLE fee_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'discount' CHECK (kind IN ('discount', 'scholarship')),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('fixed', 'percent')),
  value NUMERIC(12, 2) NOT NULL CHECK (value >= 0),
  category_id UUID REFERENCES fee_categories(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fee_discounts_institution_idx ON fee_discounts(institution_id);

-- Applied discounts (apply -> pending; approve -> reduces invoices.amount_due).
CREATE TABLE invoice_discounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  discount_id UUID REFERENCES fee_discounts(id) ON DELETE SET NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reason TEXT,
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invoice_discounts_invoice_idx ON invoice_discounts(invoice_id);
CREATE INDEX invoice_discounts_institution_idx ON invoice_discounts(institution_id);
CREATE TRIGGER invoice_discounts_set_updated_at
  BEFORE UPDATE ON invoice_discounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions
INSERT INTO permissions (key, description) VALUES
  ('fee_categories:read', 'View fee categories'),
  ('fee_categories:create', 'Create fee categories'),
  ('fee_categories:update', 'Update fee categories'),
  ('fee_categories:delete', 'Delete fee categories'),
  ('fee_schedules:read', 'View fee schedules'),
  ('fee_schedules:create', 'Create fee schedules'),
  ('fee_schedules:update', 'Update fee schedules'),
  ('fee_schedules:generate', 'Generate invoices from fee schedules'),
  ('fee_fines:read', 'View fine rules and applied fines'),
  ('fee_fines:apply', 'Create fine rules and apply late fines'),
  ('fee_fines:waive', 'Waive applied late fines'),
  ('fee_discounts:read', 'View discounts/scholarships'),
  ('fee_discounts:apply', 'Create and apply discounts/scholarships'),
  ('fee_discounts:approve', 'Approve applied discounts/scholarships'),
  ('fee_reports:read', 'View fee dues and collection reports');

-- admin: full
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key LIKE 'fee_categories:%' OR key LIKE 'fee_schedules:%'
     OR key LIKE 'fee_fines:%' OR key LIKE 'fee_discounts:%' OR key = 'fee_reports:read';

-- accountant: setup + apply, but not category delete / fine waive / discount approve
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions WHERE key IN (
    'fee_categories:read', 'fee_categories:create', 'fee_categories:update',
    'fee_schedules:read', 'fee_schedules:create', 'fee_schedules:update', 'fee_schedules:generate',
    'fee_fines:read', 'fee_fines:apply',
    'fee_discounts:read', 'fee_discounts:apply',
    'fee_reports:read'
  );
