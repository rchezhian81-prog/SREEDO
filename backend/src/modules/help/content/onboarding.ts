import type { OnboardingSection } from "../help.types";

// Section H — Super Admin onboarding guide. Curated, read-only prose that walks
// a new platform administrator through what the console is for and how to
// operate it safely. Ordered 1..15 and rendered as a linear guide.
export const onboarding: OnboardingSection[] = [
  {
    id: "what-super-admin-is-for",
    order: 1,
    title: "What Super Admin is for",
    body:
      "The Super Admin console is the platform control plane. It manages the SaaS itself — tenants (institutions), billing, subscriptions, platform staff, security, audit, backups, exports, observability and communication — not the day-to-day school/college data inside any single tenant.\n\nEverything here is cross-tenant and high-trust. Actions can affect every institution on the platform at once, so treat the console as a production system: prefer read-first, change deliberately, and confirm the blast radius before you act.",
    steps: [
      "Open the Platform Overview to see tenant counts, subscription health and recent activity at a glance.",
      "Skim the left navigation so you know which module owns which responsibility.",
      "Read the Safe operating rules section before making any change.",
      "Keep the Help / SOP Center open in a second tab while you learn the console.",
    ],
  },
  {
    id: "role-and-permission-model",
    order: 2,
    title: "Role and permission model",
    body:
      "Access is governed by RBAC. Platform staff are granted a role (for example owner, technical admin, billing admin, or read-only auditor) and each role maps to a set of permissions. The console only shows actions your role permits; the backend re-checks every request, so hiding a button is never the only guard.\n\nThe platform owner role is the most powerful and should be held by as few people as possible. Auditors get read-only visibility for compliance without the ability to change state.",
    steps: [
      "Confirm your own role and permissions before you begin.",
      "Grant the least privilege that lets a colleague do their job.",
      "Never share a login; every admin gets their own account so audit trails stay attributable.",
      "Review the platform admin list and RBAC assignments on a regular cadence.",
    ],
  },
  {
    id: "safe-operating-rules",
    order: 3,
    title: "Safe operating rules",
    body:
      "A short list of habits that prevent most incidents. Destructive actions — suspend, void, restore, broadcast-send — are irreversible or widely visible, so they always deserve a second look.\n\nWhen in doubt, stop and check a checklist or SOP rather than guessing. The console is honest about risk: warnings on a screen are there because that action has bitten someone before.",
    steps: [
      "Read the on-screen warning before confirming any destructive action.",
      "Prefer a preview or dry-run where one is offered (for example restore preview).",
      "Never test destructive flows against real tenant data — use a disposable tenant.",
      "Ensure the action will be captured in the audit log, and note why you did it.",
      "For anything you cannot cleanly undo, get the required approval first.",
    ],
  },
  {
    id: "how-to-manage-tenants",
    order: 4,
    title: "How to manage tenants",
    body:
      "Tenants are the institutions on the platform. From the Tenants module you can onboard a new institution, view its status, and suspend or reactivate it. Suspension blocks access for every user in that tenant, so it is a high-impact action.\n\nInstitution type (school vs college) is structural and set at creation; it drives which features a tenant sees.",
    steps: [
      "Open the Tenants module and locate the institution by name.",
      "To onboard, follow the New tenant onboarding SOP end to end.",
      "Before suspending, confirm you have the right tenant and a documented reason.",
      "After any change, verify the tenant's status reflects what you intended.",
    ],
  },
  {
    id: "how-to-manage-billing-and-invoices",
    order: 5,
    title: "How to manage billing and invoices",
    body:
      "SaaS Billing defines the packages/plans tenants can be on. Invoices are the individual bills issued to tenants. You can issue an invoice, and void one that was raised in error — voiding is a permanent state change and should reference a reason.\n\nOnline payment collection is an optional integration; if no gateway is configured, treat payments as recorded manually.",
    steps: [
      "Review packages in SaaS Billing to understand current plans and pricing.",
      "Issue invoices from the Invoice module; double-check tenant, amount and period.",
      "Void only genuine errors, and record why in the reason field.",
      "Reconcile paid/overdue status against your finance records regularly.",
    ],
  },
  {
    id: "how-to-manage-subscriptions",
    order: 6,
    title: "How to manage subscriptions",
    body:
      "Subscriptions link a tenant to a billing package over time — start, renewal and expiry. Renewing a subscription extends a tenant's access; letting it lapse can restrict them. Keep an eye on upcoming renewals so no tenant is cut off unexpectedly.",
    steps: [
      "Open the Subscriptions module and sort by upcoming renewal date.",
      "Follow the Subscription renewal SOP to extend a tenant's plan.",
      "Confirm the new period and package are correct after renewing.",
      "Flag any tenant nearing expiry to the billing owner in advance.",
    ],
  },
  {
    id: "how-to-use-security-center",
    order: 7,
    title: "How to use the Security Center",
    body:
      "The Security Center surfaces platform security posture — sessions, two-factor status, and security-relevant events. Use it to reset a locked-out admin's 2FA (via the approved SOP), review active sessions, and respond to suspicious activity.\n\nSecurity actions are sensitive and heavily audited; never reset another admin's second factor without verifying their identity out of band.",
    steps: [
      "Open the Security Center to review current posture and recent events.",
      "For a 2FA reset, follow the 2FA reset SOP and verify identity first.",
      "Investigate anomalies alongside the Audit Console.",
      "Escalate anything that looks like a genuine incident using the incident playbook.",
    ],
  },
  {
    id: "how-to-use-audit-console",
    order: 8,
    title: "How to use the Audit Console",
    body:
      "The Audit Console is the tamper-evident record of who did what across the platform. It is read-first by design: use it to investigate, to prove compliance, and to produce evidence exports. Auditors typically live here.\n\nTreat the audit log as the source of truth when reconstructing what happened; never assume an action occurred unless it is recorded.",
    steps: [
      "Filter the audit trail by actor, module, action or date range.",
      "Open an individual event to see its full context.",
      "For evidence, follow the Audit export SOP rather than copying rows by hand.",
      "Cross-reference with the Security Center when investigating incidents.",
    ],
  },
  {
    id: "how-to-use-support-access",
    order: 9,
    title: "How to use Support Access",
    body:
      "Support Access lets platform staff view or act within a tenant to help them, under controlled, time-bounded, audited grants. It exists so support does not require sharing tenant credentials. Every grant is logged and should be revoked when the work is done.",
    steps: [
      "Open Support Access and start a grant scoped to the specific tenant and need.",
      "Set the narrowest scope and shortest duration that solves the problem.",
      "Do your work, then revoke the grant instead of waiting for it to expire.",
      "Confirm the grant and its revocation both appear in the audit log.",
    ],
  },
  {
    id: "how-to-manage-backup-and-restore",
    order: 10,
    title: "How to manage backup and restore",
    body:
      "Backups protect platform data; restore brings data back from a backup. Creating a backup is safe. Restoring is one of the most destructive actions in the console because it can overwrite current data, so it is gated behind preview and approval.\n\nNever restore casually. Always preview first, confirm the target, and get the required sign-off.",
    steps: [
      "Create backups on a regular schedule and verify each one completes.",
      "For a restore, always run the restore preview first.",
      "Follow the Restore preview/request/approval SOP and obtain approval.",
      "After any restore, run the relevant smoke-test checklist.",
    ],
  },
  {
    id: "how-to-create-exports",
    order: 11,
    title: "How to create exports",
    body:
      "The Data Export Center produces data extracts for tenants or compliance. Exports can contain sensitive data, so requests are approved and captured in the audit trail. Large exports may be capped and produced in chunks.",
    steps: [
      "Open the Data Export Center and define the export scope precisely.",
      "Follow the Data export approval SOP; get sign-off for sensitive scopes.",
      "Deliver the export through an approved channel, never an ad-hoc one.",
      "Confirm the export request and delivery are recorded in the audit log.",
    ],
  },
  {
    id: "how-to-monitor-jobs-and-observability",
    order: 12,
    title: "How to monitor jobs and observability",
    body:
      "Health / Observability shows platform health signals; Background Jobs shows scheduled and queued work. Scheduled jobs only run if the background worker is up, so if jobs stop, check the worker first. Retrying a failed job is usually safe but read what the job does before retrying.",
    steps: [
      "Check Health / Observability for red signals at the start of your shift.",
      "Open Background Jobs to see failed or stuck work.",
      "Follow the Failed job retry SOP before retrying anything non-trivial.",
      "If scheduled jobs are not firing, confirm the worker process is running.",
    ],
  },
  {
    id: "how-to-use-communication-admin",
    order: 13,
    title: "How to use Communication Admin",
    body:
      "Communication Admin sends platform-level announcements and broadcasts. A broadcast can reach many recipients at once and cannot be unsent, so it is treated as a destructive action. Full two-way chat, SMS and marketing campaigns are out of scope here.\n\nEmail delivery depends on an optional mail service; if none is configured, broadcasts degrade to in-app only.",
    steps: [
      "Draft the message and preview exactly who will receive it.",
      "Follow the Communication/broadcast SOP before sending.",
      "Send to a test audience first when the reach is large.",
      "Confirm the broadcast is recorded and delivery status is visible.",
    ],
  },
  {
    id: "what-not-to-do",
    order: 14,
    title: "What not to do",
    body:
      "A concentrated list of things that cause the worst incidents. None of these are hypothetical — each maps to a real safeguard in the console.",
    steps: [
      "Do not run destructive flows (restore, void, suspend, broadcast) against real data to 'see what happens'.",
      "Do not share admin logins or bypass RBAC to move faster.",
      "Do not skip approvals on restore, exports, or other gated actions.",
      "Do not leave support-access grants open after the work is finished.",
      "Do not act on a tenant without confirming you have the correct one.",
      "Do not disable audit logging or work around it.",
    ],
  },
  {
    id: "emergency-contacts-and-process",
    order: 15,
    title: "Emergency contacts and process",
    body:
      "When something is genuinely on fire, follow a process, not a hunch. Identify the severity, reach for the matching emergency playbook, and escalate through your established on-call path.\n\nContacts are intentionally described as roles, not people: escalate to the platform owner via your team's on-call channel. Keep the current on-call rota in your team's operations runbook, outside this documentation.",
    steps: [
      "Assess impact and severity first (is the platform down, or is one tenant affected?).",
      "Open the matching playbook in the Help / SOP Center and follow it.",
      "Notify the platform owner through your on-call channel, with a concise status.",
      "Keep a short running timeline of what you observed and did.",
      "After resolution, capture follow-ups and update the runbook if a gap was found.",
    ],
  },
];
