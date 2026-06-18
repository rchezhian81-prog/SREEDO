-- Document/file management (Phase C): metadata for uploaded files. The bytes
-- live in object storage (S3-compatible) or local disk; only the private
-- storage_key is recorded here and is never exposed to clients (downloads go
-- through a protected, owner-scoped route). Tenant-scoped.

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL,   -- student | user | institution | message
  owner_id UUID,
  category TEXT NOT NULL,      -- profile_photo | id_card | certificate | tc | document | logo | attachment
  original_name TEXT NOT NULL,
  safe_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_mode TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX documents_owner_idx ON documents(institution_id, owner_type, owner_id);
CREATE INDEX documents_category_idx ON documents(institution_id, category);

-- Permissions catalogue + role grants (colon convention, matching 0012).
INSERT INTO permissions (key, description) VALUES
  ('documents:read', 'List/view document metadata'),
  ('documents:upload', 'Upload documents'),
  ('documents:delete', 'Delete documents'),
  ('documents:download', 'Download document files'),
  ('institution:logo:update', 'Update the institution logo');

-- admin: full document access
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('documents:read', 'documents:upload', 'documents:delete',
                'documents:download', 'institution:logo:update');

-- teacher: read/upload/download (no delete, no logo)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('documents:read', 'documents:upload', 'documents:download');

-- accountant: read/download
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('documents:read', 'documents:download');

-- student: read/upload/download their own (owner-scoped in code)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions
  WHERE key IN ('documents:read', 'documents:upload', 'documents:download');

-- parent: read/download their linked child's (owner-scoped in code)
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions
  WHERE key IN ('documents:read', 'documents:download');
