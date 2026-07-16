-- Phase 1 — Application-layer encryption for uploaded documents at rest.
-- Additive, idempotent, no destructive DDL.
--
-- New nullable column documents.enc_key_id records WHICH encryption key (by id) was
-- used to encrypt a stored document, so downloads decrypt with the right key and keys
-- can be rotated without re-encrypting everything at once. NULL means the file is
-- stored as plaintext: all existing rows, and all new uploads while
-- DOCUMENT_ENCRYPTION_KEY is unset — those stay readable, unchanged.
--
-- When a key IS configured, new uploads are encrypted with AES-256-GCM before being
-- written to storage and this column is set to the active key id. This migration alone
-- changes NOTHING in production: encryption is gated behind the (unset-by-default)
-- DOCUMENT_ENCRYPTION_KEY, so a deploy is a behavioural no-op until an operator
-- configures a key.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS enc_key_id TEXT;
