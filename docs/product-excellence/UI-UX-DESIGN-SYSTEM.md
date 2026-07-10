# UI/UX Design System — the T4+ bar, formalized

> PLANNING ONLY. Direction: **calm premium SaaS**. The T4-and-later pages
> (Students, Front-Office hub, Student Leave, Help & SOP, AI Copilot) are the
> reference generation; PX3's job is to sweep every older page up to that bar
> — not to invent a new language.

## 1. Foundations

- **Color = tokens only.** CSS vars in `globals.css`
  (`--c-app/-surface/-surface-2/-ink/-muted/-faint/-line/-hover`) surfaced as
  semantic classes (`bg-app`, `bg-surface`, `text-ink/-muted/-faint`,
  `border-line`, `shadow-card/-pop`) + `brand` blue; **School = brand-blue,
  College = violet** accents. Add formal semantic status tokens
  (success/warn/danger/info) mapped to the existing Badge tones. Rule: no raw
  Tailwind palette colors in pages outside the token set (lint in PX3).
- **Typography:** one scale — 12 (meta), 13 (table), 14 (body), 16 (section),
  20 (page title), 24 (hero numbers); weights 400/500/600/700 only; tabular
  numerals (`tabular-nums`) for money and counts.
- **Spacing:** 4-px grid. Page gutter `px-6`, card padding `p-5`, section gap
  `mb-4`/`mb-6`, control height 38–40px.

## 2. Primitives contract (all in `components/ui.tsx` — compose, never fork)

- **Card:** `rounded-2xl border-line bg-surface p-5 shadow-card`.
- **Table:** students-page canonical — `bg-surface-2` uppercase 12px header,
  `divide-line` rows, row hover, right-aligned action links, empty/loading
  states, pagination footer; wide tables scroll inside the card, never the page.
- **Forms:** `Field/Input/Select/Textarea` only; zod-mirrored inline errors;
  primary action right-aligned; destructive actions via `ConfirmDialog`.
- **Modal vs Drawer:** `Modal` for ≤1-screen create/edit/review; add a
  **Drawer** primitive (PX3) for inspect/detail flows (audit rows, report
  detail) — slides right, 480–640px, same tokens.
- **States (hard contract):** every list/detail renders all four — `Spinner`,
  `EmptyState` (with a next-step action), `ErrorNote` (with retry), content.
  PX3 includes a silent-`catch` sweep.
- **Buttons/Badges:** existing variants only; one primary per view.

## 3. Modes & platforms

- **Dark mode:** token-driven, `.dark` class, no-flash boot script (exists).
  PX3 audits older pages for hardcoded light-only colors.
- **Responsive:** dashboard fully usable at 768px (collapsible sidebar
  exists); **portal flawless at 360px** — it is the parent's phone surface.
- **Accessibility (AA):** focus-visible rings everywhere; modal focus-trap +
  Esc (exists); labeled inputs; icon-only buttons get `aria-label`; contrast
  AA on both themes; `SkipLink` (exists). A11y checklist added to PR template.

## 4. Honesty rules (already policy — made enforceable)

- **No fake data**: screenshots/demos/seeds use realistic named data
  (DEMO-TENANT-SPEC.md); never lorem, never invented metrics.
- **No emoji icons**: Lucide via the `Icon` facade only (see ICON-SYSTEM.md).

## 5. PX3 sweep method (how the older pages get found — no guessed list)

1. Inventory: script lists every `(dashboard)` page and greps for
   non-primitive patterns (raw `<table`, raw hex/palette colors, missing
   EmptyState/ErrorNote, `window.confirm`, hand-rolled modals).
2. Rank by traffic/importance (dashboard summary usage + module tier).
3. Sweep in group-sized PRs (Fees & Accounts pass, Exams pass, …), each with
   before/after screenshots in both modes + dark, and zero behavior change.
4. Definition of done per page: primitives-only, four states, tokens-only
   colors, terms adopted, a11y checklist, dark mode verified.
