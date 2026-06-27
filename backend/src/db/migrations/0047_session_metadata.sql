-- Session metadata for the "active sessions / sign out a device" feature.
-- user_agent labels the device/browser; last_used_at advances on each rotation
-- so the user can see and revoke individual sessions.

ALTER TABLE refresh_tokens ADD COLUMN user_agent TEXT;
ALTER TABLE refresh_tokens
  ADD COLUMN last_used_at TIMESTAMPTZ NOT NULL DEFAULT now();
