-- Super Admin O — Communication Admin / Email Templates / Delivery Logs / Broadcasts.
--
-- Additive + idempotent. Platform-only communication control center. Adds a
-- DB-backed platform email TEMPLATE store (+ append-only version history), a
-- unified email DELIVERY log (O-originated sends log here; the existing
-- invoice_emails log is surfaced read-only as a legacy source by the service),
-- platform BROADCASTS, and global notification category defaults. Plus granular
-- RBAC perms + indexes. NO destructive DDL; templates/versions/deliveries/
-- broadcasts are NEVER hard-deleted (disable / archive / status only). No secrets
-- are ever stored here. The existing tenant-scoped `communication`, `announcements`
-- and `notification_log` tables are left untouched.

-- 1) Platform email templates (built-ins seeded below; editable, versioned).
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,               -- stable key (e.g. 'invoice_issued')
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('onboarding','security','billing','subscription',
                        'support','backup','export','platform','broadcast','general')),
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','disabled')),
  locale TEXT NOT NULL DEFAULT 'en',
  version INT NOT NULL DEFAULT 1,
  is_builtin BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_templates_category_idx ON email_templates(category);
CREATE INDEX IF NOT EXISTS email_templates_status_idx ON email_templates(status);

DROP TRIGGER IF EXISTS email_templates_set_updated_at ON email_templates;
CREATE TRIGGER email_templates_set_updated_at
  BEFORE UPDATE ON email_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2) Append-only template version history (never hard-deleted; supports restore).
CREATE TABLE IF NOT EXISTS email_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  version INT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  change_note TEXT,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_template_versions_template_idx
  ON email_template_versions(template_id, version DESC);

-- 3) Unified platform email delivery log. O-originated sends (test / broadcast /
--    templated) log here; the service also reads legacy invoice_emails as a source.
--    Recipient is stored for ops; NO secret/token/reset-link is ever stored.
CREATE TABLE IF NOT EXISTS email_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT,
  category TEXT,
  subject TEXT,
  recipient TEXT NOT NULL,
  recipient_name TEXT,
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
  trigger_source TEXT NOT NULL DEFAULT 'system'
    CHECK (trigger_source IN ('invoice','subscription','support','security','backup',
                             'export','platform_admin','manual_test','broadcast','system')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','delivered','failed','bounced','skipped')),
  failure_reason TEXT,                    -- masked, short (no secrets)
  provider_response TEXT,                 -- masked summary (no secrets)
  retry_count INT NOT NULL DEFAULT 0,
  related_type TEXT,                      -- invoice | subscription | tenant | support | export | backup | security
  related_id UUID,
  broadcast_id UUID,                      -- FK added after broadcasts exists
  job_id UUID,
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS email_deliveries_status_idx ON email_deliveries(status);
CREATE INDEX IF NOT EXISTS email_deliveries_template_idx ON email_deliveries(template_key);
CREATE INDEX IF NOT EXISTS email_deliveries_created_idx ON email_deliveries(created_at DESC);
CREATE INDEX IF NOT EXISTS email_deliveries_recipient_idx ON email_deliveries(recipient);
CREATE INDEX IF NOT EXISTS email_deliveries_institution_idx ON email_deliveries(institution_id);
CREATE INDEX IF NOT EXISTS email_deliveries_source_idx ON email_deliveries(trigger_source);
CREATE INDEX IF NOT EXISTS email_deliveries_broadcast_idx ON email_deliveries(broadcast_id);

-- 4) Platform broadcasts / announcements (email + optional in-app). Never hard-deleted.
CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  audience TEXT NOT NULL DEFAULT 'platform_admins'
    CHECK (audience IN ('platform_admins','tenant_admins','specific_tenant',
                        'institution_type','all_tenants')),
  audience_filter JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {institutionId} | {institutionType}
  channel TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email','in_app','both')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipient_count INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  reason TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broadcasts_status_idx ON broadcasts(status);
CREATE INDEX IF NOT EXISTS broadcasts_created_idx ON broadcasts(created_at DESC);

DROP TRIGGER IF EXISTS broadcasts_set_updated_at ON broadcasts;
CREATE TRIGGER broadcasts_set_updated_at
  BEFORE UPDATE ON broadcasts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Link email_deliveries.broadcast_id → broadcasts(id) now that broadcasts exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'email_deliveries_broadcast_fk') THEN
    ALTER TABLE email_deliveries ADD CONSTRAINT email_deliveries_broadcast_fk
      FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 5) Global notification category defaults (platform singleton, id = 1). Security
--    category can be toggled but the UI warns; every change is audited.
CREATE TABLE IF NOT EXISTS platform_comm_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  categories JSONB NOT NULL DEFAULT
    '{"invoice":true,"subscription":true,"support":true,"security":true,"backup":true,"export":true,"platform_admin":true,"broadcast":true}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO platform_comm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS platform_comm_settings_set_updated_at ON platform_comm_settings;
CREATE TRIGGER platform_comm_settings_set_updated_at
  BEFORE UPDATE ON platform_comm_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6) Seed the built-in platform templates (stable keys). Idempotent; only inserts
--    missing keys, never overwrites operator edits. {{variables}} are documented
--    in the editor's variable picker.
INSERT INTO email_templates (key, name, category, subject, body_text, is_builtin, description)
SELECT v.key, v.name, v.category, v.subject, v.body_text, true, v.description FROM (VALUES
  ('tenant_admin_invite','Tenant admin invite','onboarding','You''re invited to {{platformName}}','Hi {{userName}},\n\nYou have been invited to administer {{tenantName}} on {{platformName}}. Click {{appUrl}} to get started.','Sent when a tenant admin is invited.'),
  ('platform_admin_invite','Platform admin invite','onboarding','Platform admin invite — {{platformName}}','Hi {{userName}},\n\nYou have been granted platform administrator access on {{platformName}}. Sign in at {{appUrl}}.','Sent when a platform admin is invited.'),
  ('password_reset','Password reset','security','Reset your {{platformName}} password','Hi {{userName}},\n\nA password reset was requested for your account. Use the secure link provided to reset it. If you did not request this, contact {{supportEmail}}.','Password reset request (secure link omitted from logs).'),
  ('security_notification','Security notification','security','Security notice — {{platformName}}','Hi {{userName}},\n\n{{securitySummary}}\n\nIf this wasn''t you, contact {{supportEmail}} immediately.','2FA / security account notifications.'),
  ('invoice_issued','Invoice issued','billing','Invoice {{invoiceNumber}} from {{platformName}}','Hi {{userName}},\n\nInvoice {{invoiceNumber}} for {{invoiceAmount}} has been issued to {{tenantName}}, due {{invoiceDueDate}}. Pay online: {{paymentLink}}','Sent when a SaaS invoice is issued.'),
  ('invoice_paid','Invoice paid','billing','Payment received — invoice {{invoiceNumber}}','Hi {{userName}},\n\nWe''ve received your payment of {{invoiceAmount}} for invoice {{invoiceNumber}}. Thank you.','Sent when an invoice is paid.'),
  ('invoice_voided','Invoice voided','billing','Invoice {{invoiceNumber}} voided','Hi {{userName}},\n\nInvoice {{invoiceNumber}} has been voided. No payment is due.','Sent when an invoice is voided.'),
  ('payment_link','Payment link','billing','Your payment link for invoice {{invoiceNumber}}','Hi {{userName}},\n\nPay invoice {{invoiceNumber}} ({{invoiceAmount}}) securely here: {{paymentLink}}','Payment link generated.'),
  ('payment_success','Payment success','billing','Payment successful — {{platformName}}','Hi {{userName}},\n\nYour payment of {{invoiceAmount}} was successful.','Payment success confirmation.'),
  ('payment_failed','Payment failed','billing','Payment failed — invoice {{invoiceNumber}}','Hi {{userName}},\n\nYour payment for invoice {{invoiceNumber}} failed. Please try again: {{paymentLink}}','Payment failure notice.'),
  ('subscription_renewal_reminder','Subscription renewal reminder','subscription','Your {{subscriptionPackage}} renews soon','Hi {{userName}},\n\nYour {{subscriptionPackage}} subscription for {{tenantName}} renews on {{subscriptionExpiry}}.','Renewal reminder.'),
  ('subscription_expired','Subscription expired','subscription','Your subscription has expired','Hi {{userName}},\n\nThe {{subscriptionPackage}} subscription for {{tenantName}} expired on {{subscriptionExpiry}}. Renew to restore access.','Subscription expired.'),
  ('subscription_grace','Subscription grace period','subscription','Subscription in grace period','Hi {{userName}},\n\n{{tenantName}} is in a grace period until {{subscriptionExpiry}}. Please renew to avoid suspension.','Grace period notice.'),
  ('subscription_suspended','Subscription suspended','subscription','Subscription suspended','Hi {{userName}},\n\nThe subscription for {{tenantName}} has been suspended. Contact {{supportEmail}}.','Suspension notice.'),
  ('support_session_started','Support session started','support','Support access started for {{tenantName}}','Hi {{userName}},\n\nA support session has started for {{tenantName}}. Reason/scope: {{supportScope}}.','Support session start notice.'),
  ('support_session_ended','Support session ended','support','Support access ended for {{tenantName}}','Hi {{userName}},\n\nThe support session for {{tenantName}} has ended.','Support session end notice.'),
  ('backup_failed','Backup failed','backup','Backup failed — {{platformName}}','A platform backup has failed. Status: {{backupStatus}}. Please investigate.','Backup failure alert.'),
  ('export_ready','Export ready','export','Your export "{{exportName}}" is ready','Hi {{userName}},\n\nYour export "{{exportName}}" is {{exportStatus}} and ready to download.','Export ready notice.'),
  ('security_alert','Security alert','security','Security alert — {{platformName}}','A security alert was raised: {{securitySummary}}.','High-severity security alert.'),
  ('maintenance_announcement','Maintenance announcement','platform','Scheduled maintenance — {{platformName}}','Hi {{userName}},\n\nScheduled maintenance is planned for {{platformName}}. We''ll keep disruption to a minimum.','Maintenance announcement.'),
  ('platform_broadcast','Platform broadcast','broadcast','{{platformName}} announcement','{{securitySummary}}','Default body for platform broadcasts.'),
  ('custom_notification','Custom notification','general','{{platformName}} notification','Hi {{userName}},\n\n{{securitySummary}}','General-purpose notification.')
) AS v(key, name, category, subject, body_text, description)
WHERE NOT EXISTS (SELECT 1 FROM email_templates t WHERE t.key = v.key);

-- Seed an initial version row (v1) for each built-in template that has none.
INSERT INTO email_template_versions (template_id, key, version, subject, body_text, status, change_note)
SELECT t.id, t.key, 1, t.subject, t.body_text, t.status, 'Initial built-in version'
FROM email_templates t
WHERE NOT EXISTS (SELECT 1 FROM email_template_versions v WHERE v.template_id = t.id);

-- 7) RBAC — communication-admin perms (all new). super_admin gets all; auditor
--    read-only (view logs/reports/templates/broadcasts, never send/edit).
INSERT INTO permissions (key, description)
SELECT v.key, v.description FROM (VALUES
  ('comm:dashboard_read',   'View the communication dashboard'),
  ('comm:templates_read',   'View email templates + version history'),
  ('comm:template_create',  'Create an email template'),
  ('comm:template_edit',    'Edit an email template'),
  ('comm:template_publish', 'Publish / disable an email template'),
  ('comm:template_restore', 'Restore a previous template version'),
  ('comm:test_send',        'Send a test email'),
  ('comm:deliveries_read',  'View delivery logs'),
  ('comm:delivery_retry',   'Retry a failed delivery'),
  ('comm:deliveries_export','Export delivery logs'),
  ('comm:broadcasts_read',  'View broadcasts'),
  ('comm:broadcast_create', 'Create / edit a broadcast'),
  ('comm:broadcast_send',   'Send a broadcast'),
  ('comm:broadcast_schedule','Schedule a broadcast'),
  ('comm:broadcast_cancel', 'Cancel a scheduled broadcast'),
  ('comm:preferences_manage','Manage global notification preferences'),
  ('comm:reports_read',     'View communication reports'),
  ('comm:reports_export',   'Export communication reports')
) AS v(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = v.key);

INSERT INTO role_permissions (role, permission_id)
SELECT 'super_admin', p.id FROM permissions p
WHERE p.key LIKE 'comm:%'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role='super_admin' AND rp.permission_id = p.id);

-- Auditor — read-only communication views (only when the role is in use).
INSERT INTO role_permissions (role, permission_id)
SELECT 'auditor', p.id FROM permissions p
WHERE p.key IN ('comm:dashboard_read','comm:templates_read','comm:deliveries_read','comm:broadcasts_read','comm:reports_read')
  AND EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role = 'auditor')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role='auditor' AND rp.permission_id = p.id);
