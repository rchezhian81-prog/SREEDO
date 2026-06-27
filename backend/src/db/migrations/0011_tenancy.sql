-- Multi-tenancy foundation + Super Admin.
--
-- Introduces institutions (tenants), their branches/campuses, subscription
-- packages and per-institution subscriptions, plus a super_admin role that
-- operates above any single institution. Existing domain tables are not yet
-- scoped by institution_id — that is a follow-up migration so the change can be
-- backfilled carefully.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';

CREATE TABLE institutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'school' CHECK (type IN ('school', 'college')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER institutions_set_updated_at
  BEFORE UPDATE ON institutions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name)
);

CREATE TRIGGER branches_set_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX branches_institution_id_idx ON branches(institution_id);

CREATE TABLE subscription_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  max_students INT CHECK (max_students IS NULL OR max_students >= 0),
  max_staff INT CHECK (max_staff IS NULL OR max_staff >= 0),
  price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  billing_cycle TEXT NOT NULL DEFAULT 'annual'
    CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE institution_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES subscription_packages(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trialing', 'suspended', 'cancelled')),
  starts_at DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX institution_subscriptions_institution_id_idx
  ON institution_subscriptions(institution_id);
