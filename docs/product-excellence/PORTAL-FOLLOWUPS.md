# Portal Follow-ups — T8.1, T9.1, completion pass, teacher workspace

> PLANNING ONLY. Verified baseline: `/portal` ships ~24 pages in the Deploy
> #110 route table. **No `/portal/ptm` and no portal leave page exist** — the
> guardian-scoped APIs for both shipped in T8/T9 and are production-stable,
> so both follow-ups are frontend-only against live, tested endpoints.

## 1. PR-T8.1 — Parent PTM Booking UI (P1, first)

- Pages: `/portal/ptm` — upcoming meetings for my children; per-meeting slot
  picker (teacher, time, availability); book / cancel my booking; my bookings
  list with status.
- Backend: **none expected** — reuse T8's guardian-scoped endpoints
  (meetings/slots list + booking create/cancel enforced to own children
  server-side; invites already arrive via communication).
- Rules: portal look (mobile-first 360px), terms-aware nouns, no staff data
  exposure (server already scopes; UI adds nothing), states contract, no new
  perms (guardian scoping ≠ RBAC grant), screenshots phone + desktop.
- Tests: portal booking flow integration (book, double-book rejected, cancel,
  other-child 403) if not already covered; full regression green.

## 2. PR-T9.1 — Parent/Student Leave UI (P1, second)

- Pages: `/portal/leave` — file leave for my child (`POST /student-leave/my`),
  list my requests with status/review-note (`GET /student-leave/my`), cancel
  my own pending (`DELETE /student-leave/my/:id`); student login gets a
  read view of own leave.
- Backend: none expected — T9 guardian API is live and test-proven
  (own-child 201 / other-child 403 / own cancel 204).
- Same portal rules as T8.1; note in-UI that approval marks attendance
  excused (mirrors staff-side honesty).

## 3. PR-PX4a — Portal completion pass (P2)

Notification badge parity with dashboard · profile page polish (photo,
password, linked children list) · fee receipt download polish · exam-hall/
seat info if published · portal Help subset (reuse T10 corpus read API with a
parent-safe filter — decision inside the PR, no corpus fork).

## 4. PR-PX4b — Teacher "My Day" workspace (P2, biggest experience win)

- New `/my-day` (dashboard-side, teacher-first landing): today's periods from
  the timetable, my classes' attendance quick-mark links, homework due/
  to-grade queue, marks-entry pending, my PTM slots today, pending student-
  leave for my class (if perm).
- Composes existing read APIs only; RBAC-gated per card; terms-aware; becomes
  the default post-login landing for coarse `teacher` (admin keeps /dashboard).
- No new tables; no writes beyond existing screens (cards deep-link).

## 5. Order & dependencies

T8.1 → T9.1 (independent, but ship in promised order) → PX4a → PX4b.
None depend on PX2/PX3; all precede the website screenshots (parent flows are
marketing material). Rules throughout: no Super Admin changes, no module
rewrites, additive only, open-PR → approval → merge.
