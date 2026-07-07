import type { Limitation } from "../help.types";

// Section F — known-limitation register. Honest, curated record of what the
// platform intentionally does not do yet, per module. Future work is never
// marked "fixed". `module` uses the module-map keys; `link` uses real routes.
export const limitations: Limitation[] = [
  {
    id: "tenant-admin-self-service-future",
    module: "tenant",
    title: "Tenant Admin self-service portal is a future phase",
    severity: "medium",
    status: "future",
    impact:
      "Institutions cannot yet self-manage plan changes, billing details or their own admins; these are performed by platform staff on their behalf.",
    workaround:
      "Handle tenant-side requests through the Tenants and Billing modules until the self-service portal ships.",
    ownerRole: "technical_admin",
    targetPhase: "Phase 2 — Tenant self-service",
    lastUpdated: "2026-07-07",
    link: "/super-admin/platform/tenants",
  },
  {
    id: "live-classes-provider-integration-optional",
    module: "communication_o",
    title: "Live-Classes provider API integration is optional and off by default",
    severity: "low",
    status: "future",
    impact:
      "Automatic provisioning of external live-class meeting links is unavailable unless a provider integration is configured; sessions fall back to manually entered join links.",
    workaround:
      "Enter provider join links manually per session; enable the provider integration when it is prioritised.",
    ownerRole: "technical_admin",
    targetPhase: "Phase 3 — Live-Classes provider API",
    lastUpdated: "2026-07-07",
    link: null,
  },
  {
    id: "smtp-email-optional-dependency",
    module: "communication_o",
    title: "Email delivery (SMTP) is an optional dependency",
    severity: "medium",
    status: "accepted",
    impact:
      "If no mail service is configured, email-based notifications and broadcasts degrade to in-app delivery only and outbound email is not sent.",
    workaround:
      "Configure an approved mail service to enable email; until then rely on in-app messaging and confirm recipients another way.",
    ownerRole: "technical_admin",
    targetPhase: null,
    lastUpdated: "2026-07-07",
    link: "/super-admin/communication",
  },
  {
    id: "payment-gateway-optional",
    module: "billing_c",
    title: "Online payment gateway is optional",
    severity: "medium",
    status: "accepted",
    impact:
      "When no payment gateway is configured, invoices cannot be paid online and payments must be recorded manually after settlement.",
    workaround:
      "Record payments manually and reconcile against finance records; configure a gateway to enable online collection.",
    ownerRole: "billing_admin",
    targetPhase: null,
    lastUpdated: "2026-07-07",
    link: "/super-admin/packages",
  },
  {
    id: "backup-offsite-and-encryption",
    module: "backup_j",
    title: "Offsite replication and at-rest encryption for backups are not built in",
    severity: "high",
    status: "planned",
    impact:
      "Backups are not automatically replicated to a separate location or encrypted at rest by the platform, which weakens disaster-recovery guarantees.",
    workaround:
      "Copy backups to a secure secondary location and apply storage-layer encryption through your infrastructure until native support lands.",
    ownerRole: "technical_admin",
    targetPhase: "Phase 2 — Backup hardening",
    lastUpdated: "2026-07-07",
    link: "/super-admin/backups",
  },
  {
    id: "background-worker-dependency",
    module: "jobs_m",
    title: "Scheduled and background jobs depend on the worker process running",
    severity: "medium",
    status: "accepted",
    impact:
      "If the background worker is down, scheduled jobs (reminders, digests, cleanups) silently do not run until it recovers.",
    workaround:
      "Monitor worker health in Observability; if scheduled jobs stall, restore the worker and re-run any missed jobs.",
    ownerRole: "technical_admin",
    targetPhase: null,
    lastUpdated: "2026-07-07",
    link: "/super-admin/jobs",
  },
  {
    id: "overview-saved-views-not-implemented",
    module: "overview_e",
    title: "Saved dashboard views are not implemented",
    severity: "low",
    status: "future",
    impact:
      "Administrators cannot save a customised Overview layout or filter set; the dashboard always opens in its default arrangement.",
    workaround:
      "Re-apply filters each session; capture recurring views in your own runbook until saved views are added.",
    ownerRole: "owner",
    targetPhase: "Phase 3 — Overview personalisation",
    lastUpdated: "2026-07-07",
    link: "/super-admin/platform",
  },
  {
    id: "overview-trend-history-start",
    module: "overview_e",
    title: "Trend history begins at data-collection start",
    severity: "low",
    status: "accepted",
    impact:
      "Trend charts only show data from when collection began, so early periods have no history and long-range comparisons are limited at first.",
    workaround:
      "Treat early trends as partial; history accrues over time and comparisons become meaningful as data accumulates.",
    ownerRole: "owner",
    targetPhase: null,
    lastUpdated: "2026-07-07",
    link: "/super-admin/platform",
  },
  {
    id: "help-content-curated-in-code",
    module: "help_q",
    title: "Help / SOP content is curated in code, not editable in-app",
    severity: "low",
    status: "accepted",
    impact:
      "Documentation, SOPs, checklists and playbooks are shipped as part of the build and cannot be created or edited from the console; there is no in-app publish/archive workflow.",
    workaround:
      "Propose documentation changes through the normal engineering change process; they ship with the next release.",
    ownerRole: "technical_admin",
    targetPhase: "Phase 3 — In-app doc editing",
    lastUpdated: "2026-07-07",
    link: "/super-admin/help",
  },
  {
    id: "communication-scope-limited",
    module: "communication_o",
    title: "Full two-way chat, SMS and marketing campaigns are out of scope",
    severity: "medium",
    status: "deferred",
    impact:
      "Communication Admin supports platform announcements and broadcasts only; there is no interactive chat, SMS gateway, or marketing-campaign tooling.",
    workaround:
      "Use broadcasts for one-way announcements; handle richer channels with dedicated tools outside the platform for now.",
    ownerRole: "technical_admin",
    targetPhase: "Later — Communication expansion",
    lastUpdated: "2026-07-07",
    link: "/super-admin/communication",
  },
  {
    id: "export-large-volume-caps",
    module: "export_k",
    title: "Large data exports are capped and may need chunking",
    severity: "medium",
    status: "accepted",
    impact:
      "Very large export requests are limited to protect platform performance and may fail or truncate if run in a single pass.",
    workaround:
      "Split large exports by date range or tenant and run them in chunks; schedule them during quieter periods.",
    ownerRole: "auditor",
    targetPhase: null,
    lastUpdated: "2026-07-07",
    link: "/super-admin/exports",
  },
  {
    id: "restore-point-in-time-unavailable",
    module: "backup_j",
    title: "Point-in-time restore is not available",
    severity: "high",
    status: "planned",
    impact:
      "Restores use discrete backups only, so data written between the chosen backup and the incident cannot be recovered.",
    workaround:
      "Keep backup frequency high enough to bound possible data loss; choose the closest backup before the incident.",
    ownerRole: "technical_admin",
    targetPhase: "Phase 2 — Backup hardening",
    lastUpdated: "2026-07-07",
    link: "/super-admin/backups",
  },
  {
    id: "rbac-custom-role-builder-limited",
    module: "rbac_h",
    title: "A fully custom RBAC role builder is limited",
    severity: "low",
    status: "planned",
    impact:
      "Roles are assembled from the defined permission set; there is not yet a free-form builder for arbitrary bespoke roles.",
    workaround:
      "Compose access from existing roles and permissions; request new permission definitions through engineering when needed.",
    ownerRole: "technical_admin",
    targetPhase: "Phase 3 — RBAC builder",
    lastUpdated: "2026-07-07",
    link: "/super-admin/rbac",
  },
  {
    id: "audit-retention-not-configurable",
    module: "audit_f",
    title: "Audit log retention is fixed and not yet configurable",
    severity: "medium",
    status: "planned",
    impact:
      "Retention duration for the audit trail cannot be set per-policy from the console, which may not match every compliance regime.",
    workaround:
      "Produce audit exports periodically to preserve evidence beyond the default retention window.",
    ownerRole: "auditor",
    targetPhase: "Phase 2 — Compliance controls",
    lastUpdated: "2026-07-07",
    link: "/super-admin/platform/audit",
  },
  {
    id: "security-2fa-authenticator-only",
    module: "security_p",
    title: "Two-factor is limited to authenticator apps",
    severity: "low",
    status: "future",
    impact:
      "Hardware security keys and other second-factor methods are not yet supported; only app-based one-time codes are available.",
    workaround:
      "Enrol admins with an authenticator app and keep recovery handled through the approved 2FA reset SOP.",
    ownerRole: "technical_admin",
    targetPhase: "Phase 3 — Auth methods",
    lastUpdated: "2026-07-07",
    link: "/super-admin/security",
  },
];
