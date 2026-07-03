-- Super Admin P — Platform Security & Compliance Center.
--
-- SAFE & ADDITIVE: adds two permission keys (granted to super_admin only, so no
-- existing role's permission set changes), a per-role 2FA policy table, a
-- platform-admin IP allowlist, a platform API-token store (hashed), a few
-- password-policy columns on the existing singleton security config, and read
-- indexes for the Security Center's audit-log queries. No table/column is
-- dropped, no row modified, and nothing in the auth/login path changes. Every new
-- table defaults to "empty = safe" so tests and production behave identically
-- until an operator explicitly opts in.

-- 1. Permission keys. super_admin bypasses permission checks in code, but every
--    migration still records an authoritative role_permissions grant. We grant
--    ONLY super_admin here on purpose: this leaves every existing built-in role's
--    permission set byte-for-byte unchanged (no RBAC regression). Granting the
--    Security Center to a sub-role (e.g. auditor) is done through the RBAC matrix
--    (module H) — that is exactly what H is for.
INSERT INTO permissions (key, description) VALUES
  ('platform:security_read',   'View the platform Security & Compliance Center'),
  ('platform:security_manage', 'Manage platform security policy, sessions, account locks, IP allowlist and API keys')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT v.role, p.id
FROM (VALUES
  ('super_admin', 'platform:security_read'),
  ('super_admin', 'platform:security_manage')
) AS v(role, key)
JOIN permissions p ON p.key = v.key
ON CONFLICT (role, permission_id) DO NOTHING;

-- 2. Per-role 2FA policy. ABSENCE OF A ROW = not required (the safe default).
--    grace_until NULL = immediate once required. role_key is a free-text RBAC
--    role key (validated in-service against rbac_roles), mirroring how
--    users.platform_role is stored without a hard FK so custom roles work.
CREATE TABLE IF NOT EXISTS security_2fa_policy (
  role_key TEXT PRIMARY KEY,
  require_2fa BOOLEAN NOT NULL DEFAULT false,
  grace_until DATE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Password-policy summary + IP-allowlist master switch on the existing
--    singleton config (additive columns; the seeded row and its defaults stay
--    valid). These describe/enforce nothing weaker than today's auth defaults.
ALTER TABLE platform_security_config
  ADD COLUMN IF NOT EXISTS password_min_length INT NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS password_require_complexity BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_expiry_days INT,
  ADD COLUMN IF NOT EXISTS ip_allowlist_enabled BOOLEAN NOT NULL DEFAULT false;

-- 4. Platform-admin IP allowlist (management + safety). CIDR stored as text,
--    validated in-service. Enforcement is OFF by default and is only ever applied
--    to platform-admin management surfaces — never to /auth/login — and enabling
--    is refused unless the caller's current IP already matches an entry.
CREATE TABLE IF NOT EXISTS platform_ip_allowlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cidr TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_ip_allowlist_cidr_idx ON platform_ip_allowlist(cidr);

-- 5. Platform API tokens. The full token is shown ONCE at creation and never
--    stored — only its SHA-256 hash (unique) plus a short display prefix. Scopes
--    are opaque keys; expiry/last-used/revoked drive the lifecycle. No token
--    value is ever returned again.
CREATE TABLE IF NOT EXISTS platform_api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  rotated_from UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_api_tokens_status_idx
  ON platform_api_tokens(revoked_at, expires_at);

-- 6. Read indexes for the Security Center's platform_audit_log access patterns
--    (login history, high-risk feed, per-actor timelines) and live-session
--    listing. All additive; 0039/0078 already index action and actor_id singly —
--    these composites match the (filter, newest-first) ordering used here.
CREATE INDEX IF NOT EXISTS platform_audit_log_action_created_idx
  ON platform_audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_log_actor_created_idx
  ON platform_audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refresh_tokens_active_idx
  ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
