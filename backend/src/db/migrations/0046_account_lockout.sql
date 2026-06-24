-- Per-account brute-force protection: track consecutive failed logins and a
-- temporary lock window. Complements the IP-based auth rate limiter (which slows
-- an attacker by source) with a per-account lock and an admin unlock control.

ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TIMESTAMPTZ;
