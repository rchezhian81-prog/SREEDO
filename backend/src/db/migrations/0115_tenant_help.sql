-- PR-T10 — Tenant Help/SOP Center (Module 30). Permissions-only, additive,
-- idempotent. Like the platform Help Center (0104), this module is READ-ONLY
-- curated-in-code documentation: NO tables, NO indexes, NO destructive DDL.
-- The platform `help:*` namespace stays super-admin-only and untouched; the
-- tenant surface uses its own `tenant_help:*` key (mirrors `tenant_rbac:*`).
--
-- Grant matrix (accepted defaults, PR-T10 D): every STAFF principal can read —
-- coarse admin / teacher / accountant plus all 19 finer jr_* job-roles.
-- Student and parent are NEVER granted (portal roles have no help surface).
-- tenant-rbac.job-roles.ts remains authoritative for jr_* and is updated to
-- match (belt-and-suspenders, same as 0114).

INSERT INTO permissions (key, description) VALUES
  ('tenant_help:read', 'View the tenant Help & SOP center')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_id)
SELECT r.role, p.id
FROM permissions p
CROSS JOIN (VALUES
  ('admin'),
  ('teacher'),
  ('accountant'),
  ('jr_owner_management'),
  ('jr_principal'),
  ('jr_admin_officer'),
  ('jr_academic_coordinator'),
  ('jr_admission_officer'),
  ('jr_fees_officer'),
  ('jr_exam_controller'),
  ('jr_attendance_officer'),
  ('jr_timetable_coordinator'),
  ('jr_hr_admin'),
  ('jr_hod'),
  ('jr_class_teacher'),
  ('jr_subject_teacher'),
  ('jr_front_office'),
  ('jr_librarian'),
  ('jr_transport_manager'),
  ('jr_hostel_warden'),
  ('jr_inventory_manager'),
  ('jr_auditor')
) AS r(role)
WHERE p.key = 'tenant_help:read'
ON CONFLICT (role, permission_id) DO NOTHING;
