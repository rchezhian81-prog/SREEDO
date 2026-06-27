-- Threaded messaging: conversation threads (one-to-one + group) with replies and
-- per-participant read state. Additive to the existing Communication module —
-- the legacy messages/inbox tables are untouched. Tenant-scoped; access is
-- strictly participant-scoped (a thread is visible only to its participants).

CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subject TEXT,
  type TEXT NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX threads_institution_idx ON threads(institution_id, last_message_at DESC);

CREATE TABLE thread_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (thread_id, user_id)
);
CREATE INDEX thread_participants_user_idx ON thread_participants(institution_id, user_id);
CREATE INDEX thread_participants_thread_idx ON thread_participants(thread_id);

CREATE TABLE thread_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX thread_messages_thread_idx ON thread_messages(thread_id, created_at);

-- Permissions
INSERT INTO permissions (key, description) VALUES
  ('threads:read', 'Read conversation threads you participate in'),
  ('threads:create', 'Start conversation threads'),
  ('threads:reply', 'Reply in conversation threads'),
  ('threads:delete', 'Archive your conversation threads'),
  ('threads:manage', 'Manage thread participants'),
  ('threads:reports', 'View messaging/thread reports');

-- admin: full incl. manage + reports
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions WHERE key LIKE 'threads:%';

-- teacher / accountant: start, read, reply, archive (not manage/reports)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('threads:read', 'threads:create', 'threads:reply', 'threads:delete');
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('threads:read', 'threads:create', 'threads:reply', 'threads:delete');

-- student & parent: participate + reply only (safe default — staff initiate)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions WHERE key IN ('threads:read', 'threads:reply');
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions WHERE key IN ('threads:read', 'threads:reply');
