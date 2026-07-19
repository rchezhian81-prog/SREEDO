# UI Contribution Rules (PR-UI1)

How to build UI so both skins stay correct, accessible and dormant-safe.

## Use tokens, not raw values

- **Do** use semantic Tailwind classes: `bg-surface`, `text-ink`, `text-muted`,
  `border-line`, `bg-hover`, `bg-accent`, `text-success/warn/danger/info`,
  `shadow-card/pop`. These flip correctly across light/dark and both skins.
- **Don't** hand-pick hex (`bg-[#…]`) or raw palette (`bg-slate-700`) on tenant
  pages — the design guard fails the build (`no-hex-class`, `raw-palette`).
- **Icons**: only via the `<Icon name="…">` facade (never import `lucide-react`
  directly). Icons inherit `currentColor`.

## Keep `.ui-v2` dormant

- **Never** add the `ui-v2` class to the DOM in `.ts/.tsx` (no `className`,
  `classList.add`, or theme toggle). Activation is the later theme-engine PR.
  The guard's `ui-v2-dormant` rule fails the build if you do.
- The reserved flag lives in `src/lib/ui-flag.ts` (`NEXT_PUBLIC_UI_V2`, default
  off) and is **not** wired to any runtime toggle yet.

## Glass discipline

- Frost only via `.glass-panel`, and only on **navigation, dashboards, AI and
  analytics** surfaces. The guard's `glass-allowlist` rule fails the build if
  `.glass-panel` appears elsewhere.
- **Forms and tables never frost** — keep them solid (`bg-surface`), or use
  `.glass-solid` for a panel nested inside a glass region.
- Modal/Drawer overlays use `backdrop-blur-sm` (not `.glass-panel`) and are fine.

## Off-flag identity is sacred

Any change to a shared primitive or token default **must render identically when
`.ui-v2` is absent**, in both light and dark. When you route a raw value through a
token, the token's default must equal the previous value. `ui-v2-tokens.test.ts`
guards the base brand/chart/elevation defaults.

## Accessibility

- Preserve the keyboard focus ring and `:focus-visible` behaviour.
- New colour pairings must meet **WCAG AA** (4.5:1 body text, 3:1 UI). Add a case
  to `ui-v2-tokens.test.ts` for new ink/action tokens.
- Preserve Tamil rendering (keep the Tamil fallback in any font stack) and correct
  `₹` alignment (use `.tabular-nums` / `[data-numeric]` for figures).

## Before pushing

`cd frontend && npm run typecheck && npm test && npm run guard:design && npm run build`
