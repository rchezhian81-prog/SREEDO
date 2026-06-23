-- Self-service password reset.
--
-- Stores short-lived, single-use password-reset tokens. Only the SHA-256 hash of
-- the opaque token is persisted — the raw token is emailed to the user and never
-- stored — mirroring how refresh tokens are handled. A token is consumed
-- (used_at set) on a successful reset and expires after a configurable window.

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
CREATE INDEX password_reset_tokens_expires_at_idx ON password_reset_tokens(expires_at);
