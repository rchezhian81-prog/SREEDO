-- Make webhooks real (GAP-S08 follow-up): give every endpoint an HMAC signing
-- secret and record a log of every delivery attempt. New endpoints get a strong
-- app-generated secret (shown to the admin once); pre-existing rows are
-- backfilled here so the NOT NULL column is satisfied without pgcrypto.

ALTER TABLE webhook_endpoints
  ADD COLUMN secret TEXT NOT NULL
  DEFAULT md5(random()::text || clock_timestamp()::text || gen_random_uuid()::text);
-- Drop the default so future inserts must supply an app-generated secret.
ALTER TABLE webhook_endpoints ALTER COLUMN secret DROP DEFAULT;

CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  webhook_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  status_code INT,
  success BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  attempt INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX webhook_deliveries_webhook_idx ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX webhook_deliveries_institution_idx ON webhook_deliveries(institution_id, created_at DESC);
