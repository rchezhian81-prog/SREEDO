-- AI Advanced (summaries, risk alerts, embeddings search, workflow suggestions).
-- All insights are computed deterministically from tenant-scoped data; OpenAI is
-- used only to add an optional narrative and (optionally) semantic ranking, and
-- degrades gracefully when unconfigured. No new tables — AI usage is logged
-- best-effort to MongoDB; embeddings are computed on the fly when configured.

INSERT INTO permissions (key, description) VALUES
  ('ai:read', 'View the AI insights dashboard'),
  ('ai:summarize', 'Generate AI report/KPI summaries'),
  ('ai:risk_alerts', 'View AI attendance/fee risk alerts'),
  ('ai:document_search', 'Use semantic/keyword document search'),
  ('ai:workflow_suggestions', 'View AI workflow suggestions');

-- admin: full AI access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('ai:read', 'ai:summarize', 'ai:risk_alerts', 'ai:document_search', 'ai:workflow_suggestions');

-- accountant: insights incl. fee risk + suggestions (finance focus)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('ai:read', 'ai:summarize', 'ai:risk_alerts', 'ai:document_search', 'ai:workflow_suggestions');

-- teacher: read + summaries + document search
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('ai:read', 'ai:summarize', 'ai:document_search');
