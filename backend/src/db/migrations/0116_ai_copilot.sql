-- PR-T11 — GoCampus AI Copilot Phase 1 (read-only assistant). Additive,
-- idempotent, permissions-only: no tables, no indexes, no destructive DDL.
--
-- One new permission: ai:copilot — the surface gate for POST /ai/copilot.
-- Granted to the coarse `admin` role ONLY (plan §7.3: granular over blanket).
-- jr_owner_management inherits automatically via ALL_REGISTRY_KEYS in code;
-- jr_auditor does NOT (the key is not `:read` — the copilot synthesizes across
-- modules, so it is deliberately not part of the read-only bundle). Student and
-- parent are never granted. The surface additionally requires the OFF-BY-DEFAULT
-- `aiCopilot` feature flag + OPENAI_API_KEY, so this grant alone exposes nothing.

INSERT INTO permissions (key, description) VALUES
  ('ai:copilot', 'Use the read-only AI Copilot assistant')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT 'admin', p.id FROM permissions p
WHERE p.key = 'ai:copilot'
ON CONFLICT (role, permission_id) DO NOTHING;
