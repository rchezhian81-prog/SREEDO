# GoCampusOS — 10/10 Product Excellence Master Plan

> **Status: PLANNING ONLY.** No code, no migrations, no UI/module/AI/website
> implementation is performed by this suite. Super Admin is **frozen**; the
> Tenant Admin roadmap (T0→T11) is **completed and production-stable**; the AI
> Copilot is **shipped dark** (off for every tenant). This document is the
> canonical index — each section links to its companion deep-dive doc in this
> directory. Every rating and finding cites evidence; nothing is 10/10 without
> proof.

Baseline at time of writing (2026-07-10): production on Deploy #110
(`cdf2b8c`), health `{"status":"ok","postgres":true,"mongo":true}`, full
regression 962/962 (120 files), frontend 193/193 static pages, 116 migrations.

---

## 1. Current product rating (honest)

| Surface | Rating | Basis / deductions |
|---|---|---|
| Super Admin | **9.0/10** | Complete A–Q console suite, frozen, audited, tenant-403-fenced (re-proven in T10/T11 tests). Deductions: help center is deploy-to-edit; in-memory rate limits (single instance); some consoles dense rather than task-led. |
| Tenant Admin | **8.5/10** | All 30 roadmap modules shipped (T0→T11). Deductions: portal debt (T8.1/T9.1); no teacher workspace; terminology long-tail on pre-T3 pages; legacy `/assistant` coarse-scoped (T11.1); frontend E2E thin vs backend's 962; ~61 nav items/mode. |
| Whole ERP as premium SaaS | **8.0/10** | Product strong + governed, but premium SaaS = product + polish + portals + go-to-market. Missing: website, demo path, favorites/⌘K, onboarding tours, AI pilot proof, load tests, DR rehearsal; Flutter app skeletal (39 Dart files vs ~190 web routes). |

**Why not 10/10 yet:** (1) parents cannot book PTMs or file leave from the
portal though both APIs are live; (2) teachers lack a "My Day" workspace;
(3) two visual generations of pages coexist; (4) nav is grouped but heavy with
no favorites/recents or command palette; (5) AI value unproven until piloted;
(6) no public website/pricing/demo; (7) mobile app is a stub; (8) launch
readiness (perf, DR drill, demo data, training) is documented but unrehearsed.
10/10 requires proof, not intent.

## 2. Companion documents

| Doc | Covers |
|---|---|
| `MODULE-GAP-AUDIT.md` | 24-area gap table with severity + proof required |
| `NAVIGATION-IA-AUDIT.md` | Evidence-based IA audit + target IA (diet, palette, favorites) |
| `UI-UX-DESIGN-SYSTEM.md` | Tokens, primitives, states contract, sweep method, a11y |
| `ICON-SYSTEM.md` | Lucide-only rules + enforcement |
| `AI-COPILOT-PILOT-PLAN.md` | One-tenant pilot runbook, Phase 2/3 gates, T11.1 decision |
| `PORTAL-FOLLOWUPS.md` | T8.1 / T9.1 scopes, portal completion, teacher workspace |
| `WEBSITE-PLAN.md` | Marketing site sitemap, stack, SEO, screenshot pipeline |
| `LAUNCH-READINESS.md` | QA/UAT/launch gates with evidence artifacts |
| `DEMO-TENANT-SPEC.md` | Seed spec for demos + screenshots (both modes) |
| `MOBILE-APP-DECISION.md` | Invest / park / PWA decision for the Flutter stub |

## 3. Recommended execution sequence (exact PR order)

1. **PR-PX1 — this docs suite** *(you are here; docs-only)*
2. **PR-T8.1 — Parent PTM booking UI** (API shipped in T8; highest visible value, smallest risk)
3. **PR-T9.1 — Parent/student leave UI** (guardian API shipped in T9)
4. **PR-T11.1 — Legacy `/assistant` harden/retire** (before any AI pilot attention)
5. **PR-PX2 — Navigation IA v2** (⌘K palette, favorites/recents, nav diet)
6. **PR-PX3 — UI/UX design-system sweep** (older pages → T4+ bar; may split per group)
7. **AI Phase-1 pilot** — ops only (one tenant + key), after T11.1; parallel to 5–6
8. **PR-PX4 — Teacher "My Day" + portal completion pass**
9. **Website build** — separate app/deploy, after PX3 so screenshots show final polish
10. **PR-PX5 — Launch-readiness hardening** → launch checklist sign-off

Rationale: audit-first prevents polishing the wrong things; portals before
beautification because missing promised function outweighs pixels; T11.1
before the pilot; design system before the website so marketing shows the real
product; AI pilot late and quiet.

## 4. Standing rules for the whole programme

- Super Admin stays frozen (docs links or real security fixes only).
- No completed-module rewrites; additive migrations only; every PR: open →
  review → explicit approval → merge (auto-deploys) → post-deploy confirmation.
- AI Copilot stays dark until the pilot plan is explicitly invoked; never
  enabled globally.
- No fake data anywhere (screenshots, demos, seeds); no emoji icons; Lucide via
  the `Icon` facade only.
- Evidence over intent: each excellence PR closes with proof artifacts
  (tests, screenshots, checklists) exactly like the T-series.
