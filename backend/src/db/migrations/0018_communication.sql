-- Communication & notifications (Phase C): in-app messages with per-recipient
-- read state, device tokens for push, and a log used to de-duplicate generated
-- notifications (e.g. one absence alert per student per day). All tenant-scoped.

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'message',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  audience_type TEXT,
  audience_ref UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_institution_idx ON messages(institution_id, created_at DESC);

CREATE TABLE message_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
-- A user's inbox, newest first, with unread filtering.
CREATE INDEX message_recipients_inbox_idx
  ON message_recipients(institution_id, user_id, created_at DESC);

CREATE TABLE device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user_idx ON device_tokens(institution_id, user_id);

CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  dedupe_key TEXT,
  channel TEXT,
  status TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- De-duplicate generated notifications (e.g. 'absence:<studentId>:<date>').
CREATE UNIQUE INDEX notification_log_dedupe_uidx
  ON notification_log(institution_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('communication:read', 'Read message inbox'),
  ('communication:create', 'Compose messages and view sent history'),
  ('communication:send', 'Send messages to an audience'),
  ('communication:delete', 'Delete messages'),
  ('notifications:send', 'Trigger fee reminders and absence alerts');

-- admin: full communication access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('communication:read', 'communication:create', 'communication:send',
                'communication:delete', 'notifications:send');

-- teacher & accountant: read inbox, compose/send, trigger notifications
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('communication:read', 'communication:create', 'communication:send',
                'notifications:send');
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('communication:read', 'communication:create', 'communication:send',
                'notifications:send');

-- student & parent: read their own inbox only
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions WHERE key = 'communication:read';
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions WHERE key = 'communication:read';
