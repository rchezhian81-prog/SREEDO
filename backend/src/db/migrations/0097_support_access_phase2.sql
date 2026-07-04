-- Super Admin G — Support Access (Phase 2).
--
-- Strictly ADDITIVE & IDEMPOTENT. Adds the support-approval workflow table and
-- two new granular permissions. It never drops/rewrites anything from Phase 1;
-- the tenant-notification work reuses the reserved `notify_status` / `notify_detail`
-- columns already added to platform_impersonation_sessions in 0096.

-- Approval workflow (L): a would-be high-risk (write-enabled) support session must
-- be pre-approved. Each row is an append-only request → decision record. `scope`
-- and `allowed_modules` capture the requested session shape so the decider sees
-- exactly what they are approving; `consumed_at` / `consumed_session_id` mark the
-- one session that spent an approval (single-use).
CREATE TABLE IF NOT EXISTS support_approval_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by        UUID,
  target_id           UUID,
  institution_id      UUID,
  reason              TEXT,
  reason_template     TEXT,
  scope               TEXT NOT NULL DEFAULT 'read_only',
  allowed_modules     TEXT[] NOT NULL DEFAULT '{}',
  expiry_minutes      INT NOT NULL DEFAULT 30,
  risk_reason         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  decided_by          UUID,
  decided_at          TIMESTAMPTZ,
  decision_reason     TEXT,
  consumed_at         TIMESTAMPTZ,
  consumed_session_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_approvals_status_idx       ON support_approval_requests(status);
CREATE INDEX IF NOT EXISTS support_approvals_requested_by_idx ON support_approval_requests(requested_by);

-- Granular Phase-2 permissions (platform layer). super_admin bypasses permission
-- checks at runtime; the explicit grants keep role_permissions authoritative and
-- document the intended operator model. role_permissions.role is TEXT so
-- forward-looking operator roles can be granted before they exist.
INSERT INTO permissions (key, description) VALUES
  ('platform:support_export',  'Export support-access session history and reports (CSV/XLSX, masked)'),
  ('platform:support_approve', 'Approve or reject support-access approval requests (write-enabled sessions)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
  SELECT 'super_admin', id FROM permissions
   WHERE key IN ('platform:support_export', 'platform:support_approve')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Auditors can export (read/forensic) but not approve.
INSERT INTO role_permissions (role, permission_id)
  SELECT 'auditor', id FROM permissions
   WHERE key IN ('platform:support_export')
ON CONFLICT (role, permission_id) DO NOTHING;
