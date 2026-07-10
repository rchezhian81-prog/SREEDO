# Module Gap Audit — 24 areas

> PLANNING ONLY. Snapshot at Deploy #110 (`cdf2b8c`). Method: each area was
> verified against live code, the production route table from the deploy log,
> and the T-series test evidence — not from memory. Severity: **P1** blocks
> "premium" claim · **P2** noticeable to buyers/users · **P3** polish/future.
> "Proof required" = the artifact that closes the row.

| # | Area | Status | Residual gap | Sev | Proof required to close |
|---|------|--------|--------------|-----|--------------------------|
| 1 | Student Master | ✅ Strong (shared write-column list, import, promotion, guardians, profile-v2) | No duplicate-detect/merge tool | P3 | Merge-tool spec or explicit won't-do |
| 2 | Admissions | ✅ (online admissions + public enquiry) | Document-checklist workflow light; public form polish | P3 | UX pass in PX3 |
| 3 | Academic Setup | ✅ Both modes (classes/sections vs dept/program/semester) | Year-rollover is SOP-guided, not a wizard | P3 | Wizard spec (future) |
| 4 | Attendance | ✅ Daily + period + excused integration (T9) | Biometric flow not certified against real hardware | P3 | Device pilot report |
| 5 | Fees | ✅ Deep (categories→schedules→fines→discounts→payments→receipts→refunds→reversal) | Tenant gateway config UX (deferred PR-T-GW); reconciliation report | P2 | PR-T-GW scoped or parked with reason |
| 6 | Exams | ✅ | Question bank 🔭; marks moderation workflow | P3 | Future-module decision |
| 7 | Timetable | ✅ + auto-generation | Substitute-teacher flow 🔭 | P3 | Future-module decision |
| 8 | Staff/HR | ✅ Master (T6) + attendance + leave + payroll | Recruitment/appraisal 🔭 | P3 | Future-module decision |
| 9 | Communication | ✅ (audiences, inbox, graceful SMTP) | Message templates; SMS/push provider certification | P2 | Provider cert run in LAUNCH-READINESS |
| 10 | Homework | ✅ School + college (+per-batch) | — | — | Closed |
| 11 | PTM | ✅ Staff-side complete (T8) | **Parent booking UI absent** (guardian API live; no `/portal/ptm` route in prod build) | **P1** | **PR-T8.1** |
| 12 | Leave | ✅ Staff + student (T9, excused-safe) | **Parent/student UI absent** (guardian API live; no portal leave route) | **P1** | **PR-T9.1** |
| 13 | Front Office | ✅ Unified hub (T7; old routes are redirects) | — | — | Closed |
| 14 | Transport | ✅ | GPS/live-tracking future | P3 | Decision row |
| 15 | Hostel | ✅ | — | — | Closed |
| 16 | Library | ✅ (+reservations) | Barcode hardware niceties | P3 | Decision row |
| 17 | Inventory | ✅ | — | — | Closed |
| 18 | Reports | ✅ One hub + builder + scheduled + charts | Chart depth uneven across modules | P3 | PX3 sweep list |
| 19 | Parent portal | 🟡 ~24 pages live | PTM booking, leave, notification-preference polish | **P1** | T8.1 + T9.1 + portal pass |
| 20 | Student portal | 🟡 Shares `/portal` | Own leave view/apply; exam-hall info | P2 | T9.1 + portal pass |
| 21 | Teacher portal | 🟡 None as such (RBAC-filtered dashboard) | No "My Day" workspace (periods, marking queue, homework due) | P2 | PR-PX4 |
| 22 | Admin dashboard | ✅ T4 (summary, needs-attention, search, badges) | — | — | Closed |
| 23 | Help/SOP | ✅ T10 (3 sections, 14 articles, 9 SOPs) | Deploy-to-edit (accepted); per-tenant docs future | P3 | Accepted limitation |
| 24 | AI Copilot | ✅ Shipped dark (T11) | Pilot unrun; legacy `/assistant` coarse-scoped | P2 | Pilot report + **PR-T11.1** |

**P1 summary (blockers to "premium"):** rows 11, 12, 19 — all closed by
PR-T8.1 and PR-T9.1. **P2 summary:** rows 5, 9, 20, 21, 24 — closed by
PR-T-GW decision, provider certification, T9.1, PX4, and the pilot + T11.1.

Out-of-scope now (explicitly): co-curricular, syllabus tracker, substitute
teacher, question bank (the roadmap's 🔭 set) — each needs a deliberate
future-module decision, not accidental scope creep.
