# Product Gap Analysis & Prioritized Backlog

> **Status:** Proposed (for owner review) · **Owner:** Engineering / Product · **Last updated:** 2026-06-23
>
> A prioritized backlog of **missing modules, features, and options** in GoCampus
> (SRE EDU OS). Derived from the project's own roadmap + PRD
> ([`DEV_ROADMAP.md`](../DEV_ROADMAP.md), [`PRD.md`](../PRD.md),
> [`DEVELOPER_HANDOVER.md`](../DEVELOPER_HANDOVER.md)) cross-checked against a
> code-level scan of `backend/`, `frontend/`, and `mobile/`.

## Context (read first)

GoCampus is already **highly complete** — 39 backend modules and almost the entire
planned roadmap (Phases A–E) are shipped: multi-tenancy, granular RBAC, background
jobs, observability, **scheduled backups/restore**, object storage, online
payments, GPA/CGPA foundation, ID-card/report-card/receipt PDFs, and i18n all
exist. The items below are **targeted enhancements**, not signs of an unfinished
product.

**Confidence & method:** items are tagged by how they were confirmed —
`code` (verified in source), `docs` (from roadmap/PRD/handover), or `inferred`
(reasoned from domain standards; confirm before scheduling). A few items in the
raw scan that *looked* missing are actually built (scheduled backups, CGPA
foundation, ID-card PDF generation) and have been **excluded** here.

### Legend
- Priority: 🔴 high · 🟠 medium · 🟢 nice-to-have
- Effort: **S** (≈ days) · **M** (≈ 1–2 weeks) · **L** (≈ weeks+)

### ✅ Recently shipped
- **GAP-S01** — Forgot-password / self-service reset (PR #45)
- **GAP-F01** — Bulk CSV import for students & staff (PR #46)
- **GAP-T01** — Automated deploy workflow, gated/opt-in (PR #47) — activate by adding the VPS secrets + `DEPLOY_ENABLED=true` (see [DEPLOYMENT.md → Automated deploy](../DEPLOYMENT.md))

---

## ⭐ Recommended order (first)

| # | Item | ID | Why |
|---|---|---|---|
| 1 | Forgot-password + per-account unlock | GAP-S01 | Directly fixes the admin lockout pain; every deployment needs it |
| 2 | Bulk CSV/Excel import (students & staff) | GAP-F01 | Biggest onboarding time-saver; the owner's own #1 backlog item |
| 3 | Automated deploy pipeline (CI → VPS) | GAP-T01 | Removes manual `docker compose` steps on every update |
| 4 | Two-factor auth + active-session management | GAP-S03 | Security/enterprise readiness |
| 5 | Online Admissions / Enquiry module | GAP-M02 | Largest functional module gap for a complete ERP |
| 6 | Accounting / Finance (ledger) module | GAP-M03 | Completes the financial picture beyond Fees + Payroll |

---

## 1. Missing modules (whole feature areas)

| ID | Module | Pri | Effort | Source | Notes |
|---|---|---|---|---|---|
| GAP-M01 | **Forgot-password / self-service reset** | 🔴 | S | code | No email reset flow; see GAP-S01 |
| GAP-M02 | **Online Admissions / Enquiry** | 🔴 | L | inferred | Public enquiry & application form, lead tracking, admission workflow *before* enrollment. Students module only handles enrolled students |
| GAP-M03 | **Accounting / Finance (ledger)** | 🔴 | L | inferred | Income/expense, petty cash, vouchers, day-book, GL. Fees + Payroll exist; no general bookkeeping |
| GAP-M04 | **Front Office / Reception** | 🟠 | M | inferred | Visitor management, gate pass, call log, postal dispatch/receive, enquiry & complaint desk |
| GAP-M05 | **Events & Academic Calendar / Holidays** | 🟠 | M | inferred | Holiday calendar, event scheduling, PTM/appointment booking. Today: announcements only |
| GAP-M06 | **Online Exams / Quizzes (CBT)** | 🟠 | L | code | Exams module is marks-entry only; no online test-taking, question bank, auto-grading |
| GAP-M07 | **LMS / Study materials / Lesson plans** | 🟠 | L | docs | Course content library, e-learning, syllabus tracking (PRD §4.6 noted study materials ⬜) |
| GAP-M08 | **Certificate generator (beyond TC)** | 🟠 | M | code | Bonafide / conduct / character / custom certificates; only Transfer Certificates today |
| GAP-M09 | **Health / Infirmary records** | 🟢 | M | inferred | Medical visits, vaccination, allergies |
| GAP-M10 | **Alumni** / **Placement (college)** | 🟢 | M | inferred | Alumni directory; campus placement/career |
| GAP-M11 | **Cafeteria / Mess / Meal management** | 🟢 | M | inferred | Hostel has no catering/meal-plan integration |
| GAP-M12 | **Feedback / Surveys / Grievance** | 🟢 | M | inferred | Polls, satisfaction surveys, complaint tracking |
| GAP-M13 | **Biometric / RFID & live GPS** | 🟠 | L | code | No device integration for attendance/access; transport has trip-log foundation but no live bus tracking |

---

## 2. Authentication & security options (code-confirmed)

| ID | Option | Pri | Effort | Notes |
|---|---|---|---|---|
| GAP-S01 | **Forgot password / email reset** | 🔴 | S | No `forgot-password` endpoint or reset-token table; admins reset only via server script |
| GAP-S02 | **Per-account lockout + unlock** | 🟠 | S | Only IP rate-limiting exists (the "too many requests" lockout); no per-account lock/unlock control |
| GAP-S03 | **Two-factor auth (2FA / OTP)** | 🔴 | M | No TOTP/SMS second factor |
| GAP-S04 | **Active-session list & per-session logout** | 🟠 | M | Password change revokes *all* sessions; no "log out this device" |
| GAP-S05 | **Email verification** | 🟠 | S | No `email_verified` flow |
| GAP-S06 | **SSO / OAuth (Google/Microsoft)** | 🟠 | M | No federation |
| GAP-S07 | **CAPTCHA / bot protection on login** | 🟢 | S | Rate-limit only |
| GAP-S08 | **API keys / external webhooks** | 🟢 | M | Only the payment-gateway webhook exists; no integration tokens or event webhooks |

---

## 3. Feature gaps inside existing modules

| ID | Module | Missing | Pri | Effort |
|---|---|---|---|---|
| GAP-F01 | Students / Staff | **Bulk CSV/Excel import**; qualification/appraisal records | 🔴 | M |
| GAP-F02 | Fees | Refunds for **offline** payments (online refunds exist); cheque/DD tracking; prior-year carry-forward | 🟠 | M |
| GAP-F03 | Exams | Online exams, exam timetable/seating/invigilator, question banks, supplementary papers | 🟠 | L |
| GAP-F04 | Attendance | Period/subject-wise (only daily); biometric/QR; mobile self check-in | 🟠 | M |
| GAP-F05 | Timetable | **Auto-generation** (solver); **substitution** management | 🟠 | L |
| GAP-F06 | Payroll | Overtime, bonus/incentive, statutory deductions (TDS/PF/ESI), reimbursements, bank-transfer export | 🟠 | M |
| GAP-F07 | Library | Reservations/holds, waiting-list notify, barcode-scan UI | 🟢 | M |
| GAP-F08 | Transport | Live GPS, boarding/alighting attendance, route optimization | 🟠 | L |
| GAP-F09 | Hostel | Mess/meal plans, room-swap requests, visitor log | 🟢 | M |
| GAP-F10 | Communication | Dedicated **SMS-campaign composer UI** (adapter exists, only wired to automated reminders); scheduled/deferred announcements; WhatsApp channel; announcement read receipts | 🟠 | M |
| GAP-F11 | Reports | **Charts / visual dashboards** (CSV/PDF only today); parameterized saved templates | 🟠 | M |
| GAP-F12 | Inventory | Reorder-level low-stock alerts; barcode tracking; fixed-asset/depreciation register | 🟢 | M |
| GAP-F13 | Backups | **Incremental** backups (full logical snapshots only — scheduling/retention already exist) | 🟢 | M |

---

## 4. Cross-cutting options & settings

| ID | Item | Pri | Effort | Notes |
|---|---|---|---|---|
| GAP-X01 | Per-tenant white-labeling (theme colors) | 🟠 | M | Logo upload exists; no per-institution color/full white-label |
| GAP-X02 | Per-user notification preferences | 🟠 | S | Opt in/out per channel (email/SMS/push/in-app) |
| GAP-X03 | i18n coverage completion | 🟠 | M | Only EN + TA; GoCampus-rebranded login/dashboard surfaces not yet translated; PDFs English-only; no RTL |
| GAP-X04 | Multi-currency | 🟢 | M | Single `PAYMENT_CURRENCY` today |
| GAP-X05 | Institution-admin audit viewer | 🟢 | S | Audit UI is super-admin only |
| GAP-X06 | Mobile: offline mode, biometric login, broader staff parity | 🟢 | L | |

---

## 5. Technical / engineering backlog (from project docs)

| ID | Item | Pri | Effort | Source |
|---|---|---|---|---|
| GAP-T01 | **Automated deploy pipeline** (CI builds → SSH/registry → VPS `compose up`) | 🔴 | M | docs — deploy is currently manual |
| GAP-T02 | `class_subjects` table has **no API endpoints** | 🟠 | S | handover #12 |
| GAP-T03 | Finish RBAC migration: move remaining `authorize(role)` routes to `requirePermission(key)` | 🟠 | M | docs/code |
| GAP-T04 | Money handled as JS `number` — review for paise precision | 🟠 | S | handover #9 |
| GAP-T05 | Web staff tokens in `localStorage` → consider httpOnly cookies | 🟠 | M | handover #4 (deferred) |
| GAP-T06 | Mobile widget/provider tests; promote Playwright E2E from validate-only to a browser run in CI | 🟢 | M | docs |
| GAP-T07 | Read replicas / deeper perf — only if scale signals appear | 🟢 | L | docs (optional) |

---

## How to use this backlog

1. **Owner triage:** confirm priorities — some items depend on domain decisions
   (fee rules, certificate types, which roles need 2FA). Items marked `inferred`
   need a "do we want this?" answer before scheduling.
2. **Promote an item:** when starting one, follow the
   release/change-management process and naming standard (governance suite, in
   PR #43) — branch → PR → green CI → docs + diagram + register updates.
3. **Keep it current:** tick items off here (or migrate to GitHub issues) as they
   ship; add new gaps as they're found.

> _Generated from a roadmap + code analysis on 2026-06-23. A few items are
> `inferred` from school-ERP norms — verify against actual need before building._
