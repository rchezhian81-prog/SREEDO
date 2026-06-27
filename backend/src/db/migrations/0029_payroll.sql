-- Payroll Management (Phase D). Tenant-scoped. Pulls the staff-attendance/leave
-- summary (migration 0028) to prorate pay. Payslips snapshot the computed
-- earnings/deductions + attendance for the month.

CREATE TABLE salary_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earning', 'deduction')),
  calc_type TEXT NOT NULL DEFAULT 'fixed' CHECK (calc_type IN ('fixed', 'percent')),
  default_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code)
);
CREATE INDEX salary_components_institution_idx ON salary_components(institution_id);

CREATE TABLE salary_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX salary_structures_teacher_idx ON salary_structures(institution_id, teacher_id);
-- One active structure per staff member (revision history keeps the rest inactive).
CREATE UNIQUE INDEX salary_structures_active_uidx
  ON salary_structures(institution_id, teacher_id) WHERE is_active;

CREATE TABLE salary_structure_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  structure_id UUID NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES salary_components(id) ON DELETE RESTRICT,
  calc_type TEXT NOT NULL DEFAULT 'fixed' CHECK (calc_type IN ('fixed', 'percent')),
  value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, structure_id, component_id)
);
CREATE INDEX salary_structure_components_idx ON salary_structure_components(institution_id, structure_id);

CREATE TABLE payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  finalized_by UUID REFERENCES users(id) ON DELETE SET NULL,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, month)
);

CREATE TABLE payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  working_days INTEGER NOT NULL DEFAULT 0,
  present_days INTEGER NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  paid_leave INTEGER NOT NULL DEFAULT 0,
  unpaid_leave INTEGER NOT NULL DEFAULT 0,
  half_days INTEGER NOT NULL DEFAULT 0,
  late_count INTEGER NOT NULL DEFAULT 0,
  gross NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deductions NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- No duplicate payslip for a staff member in a month.
  UNIQUE (institution_id, teacher_id, month)
);
CREATE INDEX payslips_run_idx ON payslips(institution_id, run_id);
CREATE INDEX payslips_teacher_idx ON payslips(institution_id, teacher_id);

CREATE TABLE payslip_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  payslip_id UUID NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  component_id UUID REFERENCES salary_components(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earning', 'deduction')),
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payslip_lines_idx ON payslip_lines(institution_id, payslip_id);

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('payroll:read', 'View salary components, structures and payslips'),
  ('payroll:create', 'Create salary components and structures'),
  ('payroll:update', 'Update payroll records / recalculate'),
  ('payroll:delete', 'Delete payroll records'),
  ('payroll:run', 'Run monthly payroll'),
  ('payroll:finalize', 'Finalize/lock payroll'),
  ('payroll:payslip', 'Download payslip PDFs'),
  ('payroll:reports', 'View/export payroll reports');

-- admin: full payroll access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('payroll:read', 'payroll:create', 'payroll:update', 'payroll:delete',
                'payroll:run', 'payroll:finalize', 'payroll:payslip', 'payroll:reports');

-- accountant: payroll operator (everything except delete)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('payroll:read', 'payroll:create', 'payroll:update', 'payroll:run',
                'payroll:finalize', 'payroll:payslip', 'payroll:reports');

-- teacher (staff): download only their own payslip
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions WHERE key = 'payroll:payslip';
