import type { HelpArticle, DocMeta, DocReviewStatus } from "../help.types";

// Section C — help articles. Curated, read-only how-to content for platform
// administrators, one or more per Help category. Bodies are trusted markdown-ish
// prose. `module` uses module-map keys; relatedLinks use real console routes.

const meta = (moduleOwner: string, reviewStatus: DocReviewStatus = "reviewed"): DocMeta => ({
  version: "1.0",
  lastUpdatedBy: "Platform Engineering",
  lastUpdated: "2026-07-07",
  reviewedBy: reviewStatus === "reviewed" ? "Platform Owner" : null,
  reviewStatus,
  nextReviewDate: "2026-10-07",
  moduleOwner,
});

export const helpArticles: HelpArticle[] = [
  {
    id: "getting-started-with-super-admin",
    title: "Getting started with the Super Admin console",
    category: "getting_started",
    module: "overview_e",
    appliesToRole: "Owner / Super Admin",
    summary: "Orient yourself in the platform control plane and learn how to work safely.",
    body:
      "The Super Admin console controls the SaaS platform itself — tenants, billing, security, backups and more — not the data inside any one institution.\n\n**Start here**\n\n- Open the Platform Overview for a health snapshot.\n- Learn the left-nav modules and what each owns.\n- Read the safe operating rules before making changes.\n\n**Golden rule:** actions here can affect every tenant at once. Read first, change deliberately, and confirm the blast radius before you act.",
    relatedLinks: [
      { label: "Platform Overview", href: "/super-admin/platform" },
      { label: "Help / SOP Center", href: "/super-admin/help" },
    ],
    meta: meta("owner"),
  },
  {
    id: "onboarding-a-new-tenant",
    title: "Onboarding a new tenant",
    category: "tenant_management",
    module: "tenant",
    appliesToRole: "Owner / Super Admin, Technical Admin",
    summary: "How to add a new institution and get it into a ready-to-use state.",
    body:
      "Tenants are the institutions on the platform. Onboarding creates the institution and its first admin.\n\n**Steps in brief**\n\n- Create the tenant with correct name and institution **type** (school vs college) — type is structural and drives available features.\n- Attach an appropriate billing package and subscription.\n- Create the tenant's first administrator account.\n- Verify the tenant can sign in and sees the expected mode.\n\nFor the full procedure, follow the *New tenant onboarding* SOP. Suspension and reactivation are separate, higher-impact actions.",
    relatedLinks: [
      { label: "Tenants", href: "/super-admin/platform/tenants" },
      { label: "SaaS Billing", href: "/super-admin/packages" },
    ],
    meta: meta("technical_admin"),
  },
  {
    id: "issuing-and-voiding-invoices",
    title: "Issuing and voiding invoices",
    category: "billing_and_invoices",
    module: "invoice",
    appliesToRole: "Billing Admin",
    summary: "Raise invoices for tenants and correctly void ones raised in error.",
    body:
      "Invoices are the bills issued to tenants against their plan.\n\n**Issuing**\n\n- Confirm tenant, amount, period and any line items before issuing.\n- The issued invoice becomes visible to the tenant.\n\n**Voiding**\n\n- Voiding is a permanent state change, not a delete.\n- Only void genuine errors, and always record the reason.\n- Never void to 'fix' a payment dispute — resolve those through billing.\n\nOnline payment is optional; if no gateway is configured, record payments manually.",
    relatedLinks: [
      { label: "Invoices", href: "/super-admin/invoices" },
      { label: "SaaS Billing", href: "/super-admin/packages" },
    ],
    meta: meta("billing_admin"),
  },
  {
    id: "managing-subscription-renewals",
    title: "Managing subscription renewals",
    category: "subscriptions",
    module: "subscriptions_d",
    appliesToRole: "Billing Admin",
    summary: "Keep tenants active by renewing subscriptions before they lapse.",
    body:
      "A subscription ties a tenant to a package over a period, with a start, renewal and expiry.\n\n**Good practice**\n\n- Sort the subscriptions list by upcoming renewal date.\n- Renew before expiry so tenants are never cut off unexpectedly.\n- Confirm the new period and package after renewing.\n- Flag at-risk tenants to the billing owner early.\n\nA lapsed subscription can restrict a tenant's access, so treat renewals as time-sensitive.",
    relatedLinks: [
      { label: "Subscriptions", href: "/super-admin/subscriptions" },
      { label: "SaaS Billing", href: "/super-admin/packages" },
    ],
    meta: meta("billing_admin"),
  },
  {
    id: "rbac-roles-and-least-privilege",
    title: "RBAC roles and least privilege",
    category: "security_and_rbac",
    module: "rbac_h",
    appliesToRole: "Owner / Super Admin",
    summary: "Assign platform roles with the minimum access each person needs.",
    body:
      "RBAC governs what platform staff can do. Each admin holds a role that maps to permissions; the backend enforces them on every request.\n\n**Principles**\n\n- Grant the least privilege that lets someone do their job.\n- Keep the powerful owner role to as few people as possible.\n- Give auditors read-only access for compliance work.\n- Review assignments on a regular cadence and remove stale access.\n\nChanging a role takes effect immediately, so double-check before you save.",
    relatedLinks: [
      { label: "RBAC", href: "/super-admin/rbac" },
      { label: "Platform Admin Users", href: "/super-admin/admins" },
    ],
    meta: meta("owner"),
  },
  {
    id: "using-the-security-center",
    title: "Using the Security Center",
    category: "security_and_rbac",
    module: "security_p",
    appliesToRole: "Owner / Super Admin, Technical Admin",
    summary: "Review sessions and 2FA status, and respond to security events.",
    body:
      "The Security Center shows platform security posture — sessions, two-factor status and security-relevant events.\n\n**Common tasks**\n\n- Review active sessions and revoke anything suspicious.\n- Reset a locked-out admin's 2FA using the approved SOP, after verifying identity out of band.\n- Investigate anomalies alongside the Audit Console.\n\nSecurity actions are sensitive and audited; never reset a second factor without confirming who you are helping.",
    relatedLinks: [
      { label: "Security Center", href: "/super-admin/security" },
      { label: "Audit Console", href: "/super-admin/platform/audit" },
    ],
    meta: meta("technical_admin", "needs_review"),
  },
  {
    id: "reading-the-audit-console",
    title: "Reading the Audit Console",
    category: "audit_and_compliance",
    module: "audit_f",
    appliesToRole: "Auditor (read-only)",
    summary: "Investigate who did what and produce evidence for compliance.",
    body:
      "The Audit Console is the tamper-evident record of platform activity. It is read-first by design.\n\n**How to use it**\n\n- Filter by actor, module, action or date range to narrow an investigation.\n- Open an event to see its full context.\n- For evidence, use the *Audit export* SOP rather than copying rows manually.\n\nTreat the audit log as the source of truth when reconstructing an incident.",
    relatedLinks: [
      { label: "Audit Console", href: "/super-admin/platform/audit" },
      { label: "Security Center", href: "/super-admin/security" },
    ],
    meta: meta("auditor"),
  },
  {
    id: "granting-support-access-safely",
    title: "Granting support access safely",
    category: "support_access",
    module: "support_g",
    appliesToRole: "Owner / Super Admin, Technical Admin",
    summary: "Help a tenant through controlled, time-bounded, audited access grants.",
    body:
      "Support Access lets staff act within a tenant to help them, without sharing tenant credentials. Every grant is logged.\n\n**Do it well**\n\n- Scope each grant to the specific tenant and task.\n- Choose the shortest duration that solves the problem.\n- Revoke the grant as soon as the work is done — don't wait for expiry.\n- Confirm both the grant and its revocation appear in the audit log.\n\nOpen-ended or over-broad grants are the main risk here.",
    relatedLinks: [
      { label: "Support Access", href: "/super-admin/platform/support" },
      { label: "Audit Console", href: "/super-admin/platform/audit" },
    ],
    meta: meta("technical_admin"),
  },
  {
    id: "backups-and-restore-basics",
    title: "Backups and restore basics",
    category: "backup_and_restore",
    module: "backup_j",
    appliesToRole: "Owner / Super Admin, Technical Admin",
    summary: "Create backups routinely and restore only with preview and approval.",
    body:
      "Backups protect platform data; restore brings it back.\n\n**Backups** are safe to create — do so on a schedule and verify each completes.\n\n**Restore** is one of the most destructive actions in the console because it can overwrite current data. Always:\n\n- Run the restore **preview** first.\n- Confirm the exact target.\n- Obtain the required approval (see the restore SOP).\n- Run a smoke-test checklist afterwards.\n\nPoint-in-time restore is not available; restores use discrete backups.",
    relatedLinks: [
      { label: "Backup / Restore", href: "/super-admin/backups" },
      { label: "Help / SOP Center", href: "/super-admin/help" },
    ],
    meta: meta("technical_admin"),
  },
  {
    id: "creating-data-exports",
    title: "Creating data exports",
    category: "data_exports",
    module: "export_k",
    appliesToRole: "Auditor (read-only), Technical Admin",
    summary: "Produce data extracts with approval and safe delivery.",
    body:
      "The Data Export Center produces extracts for tenants or compliance. Exports can hold sensitive data.\n\n**Process**\n\n- Define the scope precisely (tenant, entities, date range).\n- Get approval for sensitive scopes via the export SOP.\n- Deliver only through an approved channel.\n- Confirm the request and delivery are recorded in the audit log.\n\nVery large exports are capped — split them by date or tenant and run in chunks.",
    relatedLinks: [
      { label: "Data Export Center", href: "/super-admin/exports" },
      { label: "Audit Console", href: "/super-admin/platform/audit" },
    ],
    meta: meta("auditor"),
  },
  {
    id: "monitoring-jobs-and-health",
    title: "Monitoring jobs and platform health",
    category: "observability_and_jobs",
    module: "observability_l",
    appliesToRole: "Technical Admin",
    summary: "Watch health signals and keep background jobs flowing.",
    body:
      "Health / Observability shows platform signals; Background Jobs shows scheduled and queued work.\n\n**Daily habit**\n\n- Scan Observability for red signals at the start of your shift.\n- Check Background Jobs for failed or stuck work.\n- Retry failed jobs via the *Failed job retry* SOP — read what a job does before retrying.\n\n**Key dependency:** scheduled jobs only run when the background worker is up. If jobs stop firing, check the worker first.",
    relatedLinks: [
      { label: "Health / Observability", href: "/super-admin/observability" },
      { label: "Background Jobs", href: "/super-admin/jobs" },
    ],
    meta: meta("technical_admin"),
  },
  {
    id: "sending-platform-broadcasts",
    title: "Sending platform broadcasts",
    category: "communication",
    module: "communication_o",
    appliesToRole: "Owner / Super Admin",
    summary: "Send announcements safely — a broadcast cannot be unsent.",
    body:
      "Communication Admin sends platform-level announcements and broadcasts.\n\n**Before you send**\n\n- Preview exactly who will receive the message.\n- Send to a test audience first when the reach is large.\n- Remember a broadcast cannot be recalled — treat it as destructive.\n\nEmail delivery depends on an optional mail service; without it, broadcasts are in-app only. Full chat, SMS and marketing are out of scope.",
    relatedLinks: [
      { label: "Communication Admin", href: "/super-admin/communication" },
      { label: "Help / SOP Center", href: "/super-admin/help" },
    ],
    meta: meta("technical_admin"),
  },
  {
    id: "troubleshooting-common-issues",
    title: "Troubleshooting common console issues",
    category: "troubleshooting",
    module: null,
    appliesToRole: "Technical Admin",
    summary: "First moves for the most common 'something's wrong' moments.",
    body:
      "A quick triage guide before you reach for a full playbook.\n\n- **A page won't load or shows errors:** check Observability for platform health, then confirm it isn't just your session.\n- **Scheduled work isn't happening:** confirm the background worker is running (jobs depend on it).\n- **A tenant can't sign in:** check whether they were suspended and whether their subscription lapsed.\n- **Emails aren't arriving:** the mail service is optional and may be unconfigured.\n\nIf impact is platform-wide, switch to the matching emergency playbook immediately.",
    relatedLinks: [
      { label: "Health / Observability", href: "/super-admin/observability" },
      { label: "Background Jobs", href: "/super-admin/jobs" },
    ],
    meta: meta("technical_admin", "needs_review"),
  },
  {
    id: "how-release-notes-work",
    title: "How release notes work here",
    category: "release_notes",
    module: "help_q",
    appliesToRole: "Owner / Super Admin",
    summary: "Where platform changes are recorded and how to read them.",
    body:
      "Release information for the platform lives in the Help / SOP Center's release register.\n\n**What to expect**\n\n- Each entry summarises what changed, any migration or safety notes, and rollback guidance.\n- Reference numbers are only ever real, confirmed values — never fabricated — and are omitted when not known.\n\nUse release notes to understand what shipped before you smoke-test a deploy, and pair them with the deployment and rollback SOPs.",
    relatedLinks: [
      { label: "Help / SOP Center", href: "/super-admin/help" },
      { label: "Platform Overview", href: "/super-admin/platform" },
    ],
    meta: meta("owner"),
  },
  {
    id: "using-sops-and-playbooks",
    title: "Using SOPs and playbooks",
    category: "sops_and_playbooks",
    module: "help_q",
    appliesToRole: "Owner / Super Admin, Technical Admin",
    summary: "When to reach for a step-by-step SOP versus an emergency playbook.",
    body:
      "The Help / SOP Center holds two kinds of runbook content.\n\n- **SOPs** are the correct, repeatable way to perform a planned action (onboard a tenant, void an invoice, run a restore). Follow them start to finish, including approvals and the smoke-test check.\n- **Playbooks** are for emergencies (site down, database unhealthy, security incident). They lead with symptoms and what *not* to do.\n\nWhen calm, use an SOP. When something is on fire, open the matching playbook and follow it.",
    relatedLinks: [
      { label: "Help / SOP Center", href: "/super-admin/help" },
    ],
    meta: meta("technical_admin"),
  },
];
