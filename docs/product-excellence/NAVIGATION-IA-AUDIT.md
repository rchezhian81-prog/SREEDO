# Navigation / IA Audit — evidence and target

> PLANNING ONLY. Audited against `frontend/src/app/(dashboard)/layout.tsx`
> (`tenantGroups()`) and the Deploy #110 production route table on 2026-07-10.

## 1. Findings (verified, not assumed)

1. **The old 57-item flat sidebar is gone.** Nav is 11 titled groups
   (T4 IA): Overview · Academic Setup · Students & Admissions · Attendance &
   Daily Work · Fees & Accounts · Exams & Results · Staff & HR · Operations ·
   Communication · Reports · Administration.
2. **Volume persists: ~61 rendered items per mode.** Source holds 55 shared
   entries + mode-split academic (13 across both modes) + exams (3) arrays;
   only one mode's variant renders. Grouping fixed findability, not weight.
3. **Duplicate modules: none live.** T7's absorbed pages (`/feedback`,
   `/lost-found`) are redirect stubs into `/front-office?tab=…` (verified in
   code); `/visitors` has no nav entry.
4. **Reports duplication: resolved at nav level.** Exactly one hub entry
   (`/reports-hub`) plus the terminology-aware "Report Cards" (`/reports` — an
   academic document, correctly separate). `/reports-center`,
   `/report-builder`, `/scheduled-reports` are hub children, not nav entries.
5. **Dead/unwanted modules in nav: none found.**
6. **Hidden/future modules shown early: none.** Items are gated by effective
   permission (`perm`), `adminOnly`, and the tenant's enabled-modules list
   (`moduleKey`); untagged items are deliberate always-on basics.
7. **Role-based visibility: enforced.** A librarian/teacher sees a short menu
   (effective-permission gating from T2/T2.1, proven in T10/T11 screenshots).
8. **School/college terminology: done in nav** (termLabel + mode-split
   arrays); long-tail remains inside some pre-T3 page bodies (PX3 sweep).
9. **Search:** topbar `GlobalSearch` exists (backend `/search` across
   students/staff/classes). **No ⌘K command palette** (navigate + actions).
10. **Favorites / recent items: absent** (verified — no store, no UI).

## 2. Target IA (PR-PX2 scope)

- **Command palette (⌘K / Ctrl-K):** navigate to any permitted page, jump to a
  student/staff record (reuse `/search`), and run safe quick-actions
  (e.g. "Mark attendance", "File student leave" → deep-link, never execute).
- **Favorites + recents:** pin up to ~8 items to a "Pinned" block atop the
  sidebar; auto "Recent" (last 5 visited) beneath it; persisted per user
  (localStorage first; server profile later if wanted).
- **Nav diet:** default-collapse groups per role (teacher lands with
  Attendance/Homework/Exams open; accountant with Fees); "show more" folds
  long groups past 7 items; target ≤9 visible items per group pre-expansion.
- **No route changes, no renames** — IA v2 is presentation only; every URL and
  permission stays byte-identical.

## 3. Acceptance criteria for PX2

1. Palette opens ⌘K/Ctrl-K everywhere in the dashboard; results are
   permission-filtered server-truthfully (reuse `usePermissions`).
2. Pin/unpin + recents work without any backend change and survive reload.
3. Rendered default items per role measured before/after (teacher target:
   ≤25 visible pre-expansion) and recorded in the PR.
4. Zero changes to hrefs, perms, moduleKeys; full regression stays green;
   screenshots for admin + teacher, school + college, light + dark.
