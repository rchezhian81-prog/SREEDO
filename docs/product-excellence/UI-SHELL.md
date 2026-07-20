# UI-v2 Staff Application Shell (PR-UI3)

The authenticated **tenant staff** shell under the modern skin — Option B
(light, *Modern Soft Premium*) and Option C (dark, *Intelligent Glass*). It rides
the PR-UI2 theme engine and **ships OFF**: with `.ui-v2` absent (every legacy,
super-admin, and portal session) the shell renders exactly as before.

## Activation boundary (no new logic)
The shell restyle is applied only when `.ui-v2` is on `<html>`, which the PR-UI2
engine sets **iff** the build master `NEXT_PUBLIC_UI_V2==="true"` **and** the
tenant's audited `uiV2Enabled` flag is true **and** the session is authenticated
and **not** a super-admin. Any miss / error / timeout / super-admin / portal
session → no `.ui-v2` → the legacy shell. PR-UI3 adds no activation, flag, or
tenant code.

## How the restyle is scoped: `sb-*` hooks
The shell markup (`src/app/(dashboard)/layout.tsx`) carries inert hook classes —
`sb-root`, `sb-nav-active`, `sb-pin`, `sb-header`, `sb-theme-toggle`, `sb-focus`.
**Every** visual rule lives in `globals.css` under a `.ui-v2 .sb-*` selector, so
the hooks are completely inert off-flag. A test
(`(dashboard)/shell-ui-v2.test.tsx`) parses `globals.css` and asserts **no**
`sb-*` rule escapes `.ui-v2` scope — the machine-checked proof that the shell can
never restyle a legacy / super-admin / portal session.

| Surface | Light (Option B) | Dark (Option C) |
|---|---|---|
| Sidebar (`sb-root`) | deep navy/indigo | deep navy/indigo (solid) |
| Active nav (`sb-nav-active`) | violet/indigo gradient | violet/indigo gradient |
| Pins (`sb-pin`) | restrained gold | restrained gold |
| Header (`sb-header`) | soft-premium solid | **Intelligent Glass** (frosted) |
| Content / forms / tables | soft premium, **solid** | dark, **solid** (never frosted) |

Glass is applied **only** to the sticky header (a surface with content behind
it) and the mobile drawer overlay; the design-guard glass allow-list already
permits `layout.tsx`. Content, forms, and tables stay solid. Typography is
Manrope + Noto Sans Tamil (self-hosted, PR-UI1). Motion honours the existing
`@media (prefers-reduced-motion: reduce)` block; glass honours
`prefers-reduced-transparency` and is forced solid in print.

## Frozen surfaces (isolation proof)
- **Super-admin** shares `layout.tsx`, but the engine never applies `.ui-v2` to a
  `super_admin` session, and every shell rule is `.ui-v2`-scoped → the
  super-admin shell is byte-for-byte unchanged.
- **Student/Parent portal** has its own `app/portal/layout.tsx`, never runs the
  engine, and receives no `.ui-v2`; PR-UI3 edits no portal file.
- **Shared `ui.tsx` primitives + `PageHeader`** are not restyled at their base;
  they retheme only through the PR-UI1 token cascade under `.ui-v2`. The command
  palette (`components/CommandPalette.tsx`) is fully token-driven and restyles via
  the cascade with **no file edit**.

## Theme toggle (Decision 1)
The existing sun/moon toggle is kept and restyled. The a11y enhancement —
`aria-pressed` + a dynamic "Switch to light/dark mode" name + the `sb-*` restyle —
applies **only** inside an eligible UI-v2 session (`useSkinStore().active`).
Off-flag / super-admin / portal keep the exact prior markup (`aria-label="Toggle
theme"`, no `aria-pressed`, base classes). Behaviour is unchanged: it flips the
device-local `gocampus-theme` preference; UI-v2 first-use is light; dark is
user-selected, never auto-from-OS; no account-level persistence.

## Existing shell features (Decision 4)
Command palette, pins, recents, and navigation group-folding are **restyled
only** (via `sb-*` hooks + the token cascade). No new actions, routing,
permissions, or state/storage changes; keyboard operation and focus order are
preserved; off-flag versions are unchanged.

## Accessibility
Skip-to-content (`SkipLink` → `#main-content`) and the existing keyboard model
are preserved. `sb-focus:focus-visible` gives every restyled shell control a
visible violet focus ring over navy/glass. Sidebar body text keeps ≥ AA contrast
on the navy surface (asserted in tests); white active-nav text on violet and body
text/accents in both skins are covered by `ui-v2-tokens.test.ts`.

## Responsive
Breakpoints are unchanged: fixed sidebar at ≥`md` (desktop + tablet), slide-over
drawer `<md` (mobile). PR-UI3 restyles within these — no restructure. The
role-aware mobile-navigation redesign remains PR-UI8.

## Rollback
Two instant levers — turn **either** UI-v2 gate off → legacy shell; or revert the
PR (purely additive, `.ui-v2`-scoped, no migration/data). Same safety profile as
PR-UI1/UI2.
