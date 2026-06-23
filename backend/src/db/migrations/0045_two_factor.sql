-- Two-factor authentication (TOTP / authenticator app), opt-in per user.
--
-- totp_secret holds the base32 shared secret (set during enrollment); totp_enabled
-- gates whether a 6-digit code is required at login. Both are cleared on disable
-- (self, with password) or admin reset. Existing users default to disabled, so
-- current logins are unaffected.

ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT false;
