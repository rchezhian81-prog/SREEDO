# Icon System — one library, enforced

> PLANNING ONLY. Current state (verified): `lucide-react` behind the
> `<Icon name>` facade in `frontend/src/components/icons.tsx` (160+ mapped
> names); no emoji icons in product UI. This doc freezes the rules and adds
> enforcement so it stays true.

## Rules

1. **One library only:** `lucide-react`, imported **only** inside `icons.tsx`.
   Pages/components must use `<Icon name="…">`; adding a glyph = adding a
   mapping, never a direct import, never a hand-drawn SVG.
2. **Sidebar:** 18px, stroke 1.75, one icon per item; within a group no two
   items share a glyph; a module keeps the SAME glyph in sidebar, page header,
   palette results, and portal.
3. **Module icons:** page headers reuse the nav glyph at 20px; feature tiles
   (e.g. Get Started) use the brand-tinted rounded-square treatment
   (`bg-brand-500/12` school / `bg-violet-500/12` college).
4. **Active/inactive:** active = tinted pill + brand/violet icon color
   (current pattern); inactive = `text-muted`. Never a different glyph for
   active state; never fill-style switches.
5. **Sizes/strokes:** 16px inline/table · 18px nav · 20px page header ·
   24px empty-state; stroke 1.5 (16px) / 1.75 (18–20px). No other sizes.
6. **Color:** neutral outline set; color communicates state only (brand/violet
   active, muted inactive, semantic tones for status chips). No decorative
   multicolor icons.
7. **Forbidden:** emoji anywhere in product UI, mixed libraries, ad-hoc SVGs,
   PNG icons, per-page one-off styles.
8. **School/college tone:** identical glyph set for both modes — the accent
   color carries the mode, not different icons.

## Enforcement (PX3)

- ESLint: `no-restricted-imports` for `lucide-react` outside
  `components/icons.tsx`; a simple emoji-in-JSX check for `(dashboard)`/
  `portal` sources.
- PR checklist line: "icons via facade, sizes per ICON-SYSTEM".
- Palette/favorites (PX2) must consume the same facade.
