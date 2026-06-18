-- Fee receipts & ID cards (Phase C): no new tables — PDFs are generated on the
-- fly from existing payments/invoices/students/users + the documents table (for
-- photos/logo). This migration only adds permissions.

INSERT INTO permissions (key, description) VALUES
  ('fee_receipts:read', 'View fee receipts'),
  ('fee_receipts:generate', 'Generate/regenerate fee receipts'),
  ('fee_receipts:download', 'Download a fee receipt PDF'),
  ('id_cards:read', 'View ID cards'),
  ('id_cards:generate', 'Generate ID cards (incl. bulk)'),
  ('id_cards:download', 'Download an ID card PDF');

-- admin: everything
INSERT INTO role_permissions (role, permission_id)
  SELECT 'admin', id FROM permissions
  WHERE key IN ('fee_receipts:read', 'fee_receipts:generate', 'fee_receipts:download',
                'id_cards:read', 'id_cards:generate', 'id_cards:download');

-- accountant: fee receipts (full) + view/download ID cards
INSERT INTO role_permissions (role, permission_id)
  SELECT 'accountant', id FROM permissions
  WHERE key IN ('fee_receipts:read', 'fee_receipts:generate', 'fee_receipts:download',
                'id_cards:read', 'id_cards:download');

-- teacher: ID cards (incl. bulk) + view receipts
INSERT INTO role_permissions (role, permission_id)
  SELECT 'teacher', id FROM permissions
  WHERE key IN ('id_cards:read', 'id_cards:generate', 'id_cards:download',
                'fee_receipts:read');

-- student & parent: download their own / their child's receipt + ID card
INSERT INTO role_permissions (role, permission_id)
  SELECT 'student', id FROM permissions
  WHERE key IN ('fee_receipts:download', 'id_cards:download');
INSERT INTO role_permissions (role, permission_id)
  SELECT 'parent', id FROM permissions
  WHERE key IN ('fee_receipts:download', 'id_cards:download');
