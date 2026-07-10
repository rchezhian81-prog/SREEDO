# Launch Readiness — QA / UAT / go-live gates

> PLANNING ONLY. Every gate closes with a named **evidence artifact** checked
> into `docs/product-excellence/evidence/` (or linked CI run). A gate without
> evidence is not passed — same standard the T-series used.

| # | Gate | What passes it | Evidence artifact |
|---|------|----------------|-------------------|
| 1 | Regression | Full backend suite green (baseline 962 + all new suites) on the release SHA; frontend build clean | CI run link |
| 2 | Security | AuthZ matrix re-run (per coarse role + all 19 job-roles × sensitive endpoints); `npm audit` clean-or-waived; secret scans (repo + bundled-content) green; rate-limit probes (auth, tenant, copilot) return 429s | `security-pass.md` |
| 3 | Cross-tenant leak matrix | ONE automated two-tenant sweep hitting every module's list+detail+export as tenant B against tenant A ids → all 403/404/empty (consolidates the per-module isolation tests into a single matrix suite) | new `tenant-leak-matrix.int.test.ts` green |
| 4 | RBAC matrix | Per job-role smoke: login as each of the 19 jr_* → sidebar + one read per granted group + one 403 per denied group | `rbac-matrix.md` + screenshots |
| 5 | Performance | k6/autocannon on top-10 endpoints against a 10k-student seeded DB; budgets p95: reads <300ms, dashboards <600ms, imports throughput noted; VPS headroom recorded | `perf-report.md` |
| 6 | Backup/restore drill | Restore a REAL production backup file onto a scratch stack; app boots; row counts + spot checks match; timed RTO recorded (target <30min) | `dr-drill.md` |
| 7 | AI pilot safety | Pilot ran per AI-COPILOT-PILOT-PLAN; 20-turn audit sample reviewed; 0 safety incidents; cost within caps | `ai-pilot-report.md` |
| 8 | Mobile responsive | Portal sweep at 360/390px (all parent flows incl. T8.1/T9.1), dashboard at 768px | screenshot set |
| 9 | Browser pass | Chrome/Edge/Firefox/Safari (current−1): login, students table, fees payment, portal booking | `browser-pass.md` |
| 10 | Demo tenant | Seeded per DEMO-TENANT-SPEC (both modes), used for website shots + sales demos; reseed script idempotent | seed script + walkthrough video |
| 11 | Training/SOP | T10 corpus current; 5 short screen-recordings (setup, daily attendance, fees day, exams cycle, PTM); admin onboarding checklist | video links |
| 12 | Launch checklist | Named sign-offs: product owner (features), operator (infra/DR), this assistant (evidence complete); rollback plan restated; support/status page live | `launch-signoff.md` |

## Sequencing

Gates 1–4 run continuously (each excellence PR must keep them green).
Gates 5–6 are one dedicated hardening effort (PR-PX5 + an ops window).
Gate 7 follows the pilot. Gates 8–11 finish after PX3/PX4/website.
Gate 12 last. **No public launch before all 12 have artifacts.**
