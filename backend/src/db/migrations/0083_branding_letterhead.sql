-- Tenant branding: letterhead + footer text for printed documents
-- (reports / certificates / letters). ADDITIVE & SAFE — nullable columns on the
-- existing per-institution branding row; nothing dropped.

ALTER TABLE institution_branding
  ADD COLUMN IF NOT EXISTS letterhead TEXT,
  ADD COLUMN IF NOT EXISTS footer TEXT;
