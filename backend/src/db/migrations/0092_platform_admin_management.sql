-- Super Admin I — Platform Admin User Management & Security Controls.
--
-- SAFE & ADDITIVE: new nullable columns, new tables, one new permission, and
-- indexes only. The single data change is a one-time backfill setting existing
-- super-admins to platform_role='owner' so the "cannot disable the last owner"
-- safeguard has an anchor from day one. No row is deleted; no column dropped.
--
-- Scope note: platform_role classifies the internal GoCampusOS team and drives
-- display + assignment + owner-safety. Per-role permission ENFORCEMENT across
-- routes is the separate RBAC module (H); this migration deliberately does NOT
-- touch the user_role enum.

-- 1. Platform sub-role + last-login on users. Only meaningful for platform users
--    (role='super_admin' AND institution_id IS NULL). Nullable so every existing
--    tenant user stays valid.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS platform_role TEXT
    CHECK (platform_role IS NULL OR platform_role IN
      ('owner', 'platform_admin', 'support_operator', 'billing_admin', 'auditor', 'technical_admin')),
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Backfill: existing platform super-admins are the founding owners.
UPDATE users SET platform_role = 'owner'
  WHERE role = 'super_admin' AND institution_id IS NULL AND platform_role IS NULL;

CREATE INDEX IF NOT EXISTS users_platform_role_idx
  ON users(platform_role) WHERE platform_role IS NOT NULL;

-- 2. Per-session IP (device/browser is already captured as user_agent in 0047).
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip TEXT;

-- 3. Platform-team invitations. Accepting creates the super_admin user with the
--    invited platform_role; until acceptance no user row exists, so "cancel
--    invite" is clean and never orphans an account.
CREATE TABLE IF NOT EXISTS platform_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  platform_role TEXT NOT NULL
    CHECK (platform_role IN
      ('owner', 'platform_admin', 'support_operator', 'billing_admin', 'auditor', 'technical_admin')),
  full_name TEXT,
  token_hash TEXT NOT NULL UNIQUE,          -- SHA-256 of the single-use emailed token
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_by_email TEXT,
  accepted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_invites_email_idx ON platform_invites(lower(email));
CREATE INDEX IF NOT EXISTS platform_invites_status_idx ON platform_invites(status, created_at DESC);

-- 4. Platform security policy (singleton, mirrors platform_settings shape).
--    force_2fa_for_platform lets the console flag/require 2FA for the team.
CREATE TABLE IF NOT EXISTS platform_security_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  force_2fa_for_platform BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_security_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- 5. Permission for the platform-team console. Granted to super_admin (which also
--    bypasses requirePermission in code); the grant keeps the RBAC matrix honest
--    and lets module H later delegate it to a platform_admin sub-role.
INSERT INTO permissions (key, description) VALUES
  ('platform:manage_admins', 'Manage the internal platform admin team (users, roles, 2FA, sessions, login history)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
  SELECT 'super_admin', id FROM permissions WHERE key = 'platform:manage_admins'
ON CONFLICT DO NOTHING;
