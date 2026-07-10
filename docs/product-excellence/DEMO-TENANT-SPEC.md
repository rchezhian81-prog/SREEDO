# Demo Tenant Spec — realistic seed for demos & screenshots

> PLANNING ONLY. One idempotent seed script (future PR-PX5 scope) produces two
> demo tenants used for sales demos, website screenshots, and UAT. **No fake
> placeholder data** — realistic Indian school/college names, terms and
> amounts; no real personal data.

## Tenants

1. **Greenfield Public School** (school mode, brand-blue) — the flagship demo.
2. **Summit Degree College** (college mode, violet) — proves the mode engine.

## Seed contents (per tenant, sized for believable screens, not load tests)

- Academic year current + previous; school: Grades 1–10 × sections A/B;
  college: 3 departments, 5 programs, semesters 1–6.
- People: ~400 students (school) / ~600 (college) with guardians linked to
  parent logins; 35 teachers/faculty with job-roles spread across all 19
  jr_* (so the RBAC matrix demo is real); 6 non-teaching staff (T6).
- Daily texture (last 60 days): attendance ~92% with a few at-risk students
  (feeds AI insights/risk screens honestly); homework per class/program;
  2 exams with entered marks + published report cards/grade sheets.
- Fees: categories/schedules/fines/discounts; ~70% collected, some overdue
  (dues screens + fee-risk look real); a few receipts, one refund, zero fake
  currency totals.
- Modules: PTM meeting with slots + bookings; student-leave requests in all
  four statuses; front-office entries (visitors, enquiries, postal, calls,
  lost&found); library/transport/hostel/inventory minimal-but-real rows;
  announcements + messages so inboxes aren't empty.
- Logins (documented in the runbook, demo-only passwords rotated):
  owner-admin, principal (jr), fees officer (jr), class teacher (jr),
  librarian (jr), one parent (2 children), one student.

## Rules

- Idempotent: re-run wipes & reseeds ONLY the two demo tenants (never touches
  other institutions); guarded by tenant code allow-list.
- Dates relative to "today" so screens never look stale.
- The AI Copilot flag stays OFF on demo tenants unless a pilot demo is
  explicitly scripted (then flipped for the session and back off).
- Screenshots for web/marketing come ONLY from these tenants via the
  Playwright pipeline (2× scale, light+dark, both modes).
