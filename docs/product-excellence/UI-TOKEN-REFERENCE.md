# UI Token Reference (PR-UI1)

The GoCampus semantic design-token foundation. Two skins live in
`frontend/src/app/globals.css` and are switched on **only** when an ancestor
carries the `.ui-v2` class:

- **Light — "Modern Soft Premium"** → `.ui-v2:not(.dark)`
- **Dark — "Intelligent Glass"** → `.ui-v2.dark`

PR-UI1 never applies that class (the theme engine is a later PR), so with it
absent every token resolves to the **exact pre-PR-UI1 value** and the app renders
byte-for-byte identically.

## How the mapping works

Colours are stored as space-separated RGB triplets in CSS variables and exposed
through Tailwind as `rgb(var(--token) / <alpha-value>)`, so opacity modifiers
(`bg-accent/12`) work. The `brand` ramp, chart series and elevation shadows were
made variable-backed **at their exact previous values**, so existing
`brand-*` / `shadow-card` / chart usages retheme under `.ui-v2` with **no class
changes** and **no off-flag drift**.

## Token families

| Family | Tokens | Notes |
|--------|--------|-------|
| Surface | `--c-app`, `--c-surface`, `--c-surface-2`, `--c-hover` | page → panel → subtle fill → hover |
| Text | `--c-ink`, `--c-muted`, `--c-faint` | primary / secondary / tertiary |
| Line | `--c-line` | borders, dividers |
| Action | `--c-accent`, `--c-accent-strong`, `--shadow-accent` | primary button/links; violet under `.ui-v2` |
| Brand ramp | `--brand-50 … --brand-900` | var-backed; blue off-flag, violet on-flag |
| Secondary | `--c-indigo`, `--c-gold` | indigo pairing + restrained gold |
| Status | `--c-success`, `--c-warn`, `--c-danger`, `--c-info` | theme-aware; also Tailwind `success/warn/danger/info` |
| Charts | `--chart-1 … --chart-6`, `chart-primary` | series palette; violet/indigo/gold on-flag |
| Elevation | `--elevation-1/2/3` → `shadow-card/pop/float` | softer, deeper under `.ui-v2` |
| Radius | `--radius-sm/md/lg/xl/2xl/pill` | |
| Spacing | `--space-1 … --space-8` | 4px scale |
| Border | `--border-thin`, `--border-med` | |
| Motion | `--motion-fast/base/slow`, `--motion-ease` | |
| Density | `--density-row`, `--density-control` | |
| Focus | `--focus-ring`, `--focus-offset` | keyboard-focus ring |
| Glass | `--glass-bg`, `--glass-border`, `--glass-blur`, `--glass-saturate`, `--glow-accent` | **allow-listed** — nav / dashboards / AI / analytics only |
| Typography | `.ui-v2` font-family (Manrope + Noto Sans Tamil), `--font-tamil`, `.tabular-nums` | self-hosted `@font-face` |

## Rules baked into the tokens

- **Light default.** No `.ui-v2` → the current light/dark experience is unchanged.
- **Dark forms & tables stay solid.** Glass is opt-in via `.glass-panel`; a
  `.glass-solid` escape hatch forces solid surfaces inside a glass region.
- **Print/receipts forced light.** `@media print` under `.ui-v2` resets to a light
  scheme and disables glass.
- **Reduced transparency / motion respected** via media queries.
- **WCAG AA** verified for ink, muted and the primary action in both skins
  (`ui-v2-tokens.test.ts`).
