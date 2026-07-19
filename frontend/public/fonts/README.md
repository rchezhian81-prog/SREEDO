# Self-hosted fonts (PR-UI1)

The `.ui-v2` modern skin uses two self-hosted, open-source typefaces, declared via
`@font-face` in `src/app/globals.css`. **No external font host is ever requested**,
and the app shell (`layout.tsx`) is **not** modified — the families apply only under
the dormant `.ui-v2` scope.

## Committed files

| File | Family | Subset / axis | Bytes | Source | License |
|------|--------|---------------|-------|--------|---------|
| `manrope-variable.woff2` | Manrope | latin, wght 300–800 (variable) | 24,836 | `@fontsource-variable/manrope@5.3.0` | SIL OFL 1.1 |
| `noto-sans-tamil-variable.woff2` | Noto Sans Tamil | tamil, wght 300–800 (variable) | 50,468 | `@fontsource-variable/noto-sans-tamil@5.3.0` | SIL OFL 1.1 |

Both are the official upstream builds redistributed by **Fontsource** under OFL-1.1
(see `OFL.txt` for attribution and Reserved Font Names). Subsets chosen for this
product: **Manrope latin** (English UI + digits) and **Noto Sans Tamil tamil** —
whose Google subset range (`U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC`)
includes the Rupee sign **₹ (U+20B9)**, so currency renders in the Tamil face.
`@font-face` declares `font-weight: 300 800` + `font-display: swap`, so one variable
file per family covers every weight and text stays visible while loading.

## Coverage & fallbacks

- **English / Latin** → Manrope, else the system UI sans stack.
- **Tamil** → Noto Sans Tamil (forced for `:lang(ta)`), else `Latha → Nirmala UI →
  sans-serif` — so Tamil always renders.
- **₹** → Noto Sans Tamil / system, both of which include the glyph.

Additional subsets (Manrope `latin-ext`, Cyrillic, Greek, Vietnamese; Noto Tamil
`latin`) can be added later as extra `@font-face` blocks with a `unicode-range` if
needed — not required for English + Tamil.

## Regenerating / updating

```
npm i -D @fontsource-variable/manrope @fontsource-variable/noto-sans-tamil
cp node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2 \
   frontend/public/fonts/manrope-variable.woff2
cp node_modules/@fontsource-variable/noto-sans-tamil/files/noto-sans-tamil-tamil-wght-normal.woff2 \
   frontend/public/fonts/noto-sans-tamil-variable.woff2
```

Keep `OFL.txt` alongside the binaries.
