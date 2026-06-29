-- Support-access (impersonation) session tracking — ADDITIVE & SAFE.
--
-- Impersonation tokens are stateless, short-lived, reason-gated scoped JWTs that
-- never escalate privilege. This table records each active support session so the
-- platform can ENFORCE "one active session per super-admin at a time" server-side
-- (not just in the client UI) and provide an audited End action. It does NOT
-- revoke the issued token (the scoped token simply expires); it gates STARTING a
-- second concurrent session and records the lifecycle.

CREATE TABLE IF NOT EXISTS platform_impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_email TEXT NOT NULL,
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One un-ended, un-expired session per actor is the invariant the start-guard
-- checks; this partial index makes that lookup trivial.
CREATE INDEX IF NOT EXISTS platform_impersonation_active_idx
  ON platform_impersonation_sessions(actor_id)
  WHERE ended_at IS NULL;
