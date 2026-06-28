-- Platform Console completion — performance indexes for the super-admin platform
-- module (institution directory search/sort, audit-log search/filter/sort, and
-- the support user-selector). ADDITIVE & SAFE: indexes only; no table or column
-- is changed and no data is touched.

-- Trigram search for case-insensitive substring (ILIKE '%q%') lookups used by
-- the institution directory and the support user search. pg_trgm is a standard
-- contrib extension shipped with the Postgres image.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Institutions: directory search (name/code) + sort by created_at.
CREATE INDEX IF NOT EXISTS institutions_name_trgm
  ON institutions USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS institutions_code_trgm
  ON institutions USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS institutions_created_at_idx
  ON institutions (created_at DESC);

-- Platform audit log: the filter + sort columns the audit viewer uses.
CREATE INDEX IF NOT EXISTS platform_audit_created_at_idx
  ON platform_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_institution_idx
  ON platform_audit_log (institution_id);
CREATE INDEX IF NOT EXISTS platform_audit_action_idx
  ON platform_audit_log (action);
CREATE INDEX IF NOT EXISTS platform_audit_actor_idx
  ON platform_audit_log (actor_id);
CREATE INDEX IF NOT EXISTS platform_audit_target_type_idx
  ON platform_audit_log (target_type);

-- Users: support-access selector search by name/email.
CREATE INDEX IF NOT EXISTS users_email_trgm
  ON users USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_full_name_trgm
  ON users USING gin (full_name gin_trgm_ops);
