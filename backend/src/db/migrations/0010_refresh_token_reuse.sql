-- Refresh-token rotation with reuse detection.
--
-- Rotated tokens are now marked revoked (revoked_at) and retained briefly rather
-- than deleted immediately, so that presenting an already-rotated token can be
-- detected as theft and trigger revocation of all the user's sessions. Expired
-- and old revoked tokens are purged opportunistically on login.

ALTER TABLE refresh_tokens ADD COLUMN revoked_at TIMESTAMPTZ;

CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens(expires_at);
