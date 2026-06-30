-- Super Admin N — Global Platform Settings + Feature-flag governance.
-- ADDITIVE & SAFE: only new tables, permissions and grants are introduced. No
-- existing column is changed and no data is removed. Tenant-specific settings
-- continue to live on institutions.settings (the Tenant module is the single
-- source of truth); this migration only adds PLATFORM-GLOBAL configuration.
-- Settings/flag changes are audited via the existing platform_audit_log table
-- (no new audit table) — see target_type 'platform_settings' / 'feature_flag'.

-- 1. Platform settings (single row, classic singleton guard). Holds platform-wide
--    defaults and identity. Secrets are NEVER stored here — only safe, operator
--    chosen configuration.
CREATE TABLE IF NOT EXISTS platform_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  -- identity / support
  platform_name TEXT NOT NULL DEFAULT 'GoCampusOS',
  platform_display_name TEXT,
  support_email TEXT,
  support_phone TEXT,
  -- locale / regional defaults
  default_country TEXT,
  default_state TEXT,
  default_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  default_currency TEXT NOT NULL DEFAULT 'INR',
  default_language TEXT NOT NULL DEFAULT 'en',
  academic_year_format TEXT NOT NULL DEFAULT 'YYYY-YYYY',
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  time_format TEXT NOT NULL DEFAULT '24h' CHECK (time_format IN ('12h', '24h')),
  financial_year_start_month INT NOT NULL DEFAULT 4
    CHECK (financial_year_start_month BETWEEN 1 AND 12),
  internal_notes TEXT,
  -- maintenance window (real, persisted + audited; traffic blocking is NOT
  -- enforced here — the value is surfaced as a banner where supported)
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_message TEXT,
  maintenance_starts_at TIMESTAMPTZ,
  maintenance_ends_at TIMESTAMPTZ,
  -- platform announcement / banner
  announcement_active BOOLEAN NOT NULL DEFAULT FALSE,
  announcement_text TEXT,
  announcement_visibility TEXT NOT NULL DEFAULT 'super_admin'
    CHECK (announcement_visibility IN ('super_admin', 'tenant_admins', 'all_users')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Seed the single settings row with safe defaults (idempotent).
INSERT INTO platform_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- 2. Platform feature flags (governance registry). Flags are created/managed and
--    audited here; runtime consumption is wired per-feature deliberately (a flag
--    existing here does not by itself enable/hide anything until a feature reads
--    it) so this can never accidentally expose an unfinished module.
CREATE TABLE IF NOT EXISTS platform_feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  default_value BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('enabled', 'disabled', 'rollout')),
  scope TEXT NOT NULL DEFAULT 'global'
    CHECK (scope IN ('global', 'tenant', 'package')),
  rollout_percentage INT
    CHECK (rollout_percentage IS NULL OR rollout_percentage BETWEEN 0 AND 100),
  allowed_tenants UUID[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_feature_flags_status_idx
  ON platform_feature_flags(status);

-- 3. New platform permissions for the settings surface (super-admin only; no
--    tenant role ever receives a platform:* key). super_admin already bypasses
--    permission checks, but the explicit grants keep role_permissions authoritative.
INSERT INTO permissions (key, description) VALUES
  ('platform:settings_read', 'View global platform settings, feature flags and settings history'),
  ('platform:settings_manage', 'Edit global platform settings and manage feature flags')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
  SELECT 'super_admin', id FROM permissions
  WHERE key IN ('platform:settings_read', 'platform:settings_manage')
ON CONFLICT DO NOTHING;
