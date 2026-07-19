# Self-hosted fonts (PR-UI1)

The `.ui-v2` modern skin uses two self-hosted, open-source typefaces, declared via
`@font-face` in `src/app/globals.css`. **No external font host is ever requested**
(the CSP/offline posture requires everything local), and the app shell
(`layout.tsx`) is intentionally **not** modified — the families apply only under the
dormant `.ui-v2` scope.

## Files this folder must contain

| File | Family | Axis / weights | License |
|------|--------|----------------|---------|
| `manrope-variable.woff2` | `Manrope` | variable, wght 300–800 | SIL OFL 1.1 |
| `noto-sans-tamil-variable.woff2` | `Noto Sans Tamil` | variable, wght 300–800 | SIL OFL 1.1 |

Both are the **variable** woff2 builds. `@font-face` declares `font-weight: 300 800`
and `font-display: swap`, so a single file covers every weight and text stays visible
during load. The Tamil face carries a `unicode-range` so it is fetched only for Tamil
(and ₹) glyphs.

## Sourcing (add the binaries before activating `.ui-v2`)

- **Manrope** — https://github.com/sharanda/manrope (SIL OFL 1.1). Use the variable
  `Manrope[wght].woff2`, rename to `manrope-variable.woff2`.
- **Noto Sans Tamil** — https://github.com/notofonts/tamil / Google Fonts (SIL OFL 1.1).
  Use the variable `NotoSansTamil[wght].woff2`, rename to `noto-sans-tamil-variable.woff2`.

> These binaries are **not committed in PR-UI1** (this environment has no outbound
> access to fetch them). Because `.ui-v2` is dormant, nothing requests them at runtime,
> so the missing files have **zero production effect**. Dropping in the two properly
> licensed woff2 files is the only remaining asset step before the skin is ever
> activated. Keep the license text (`OFL.txt`) alongside them.

Until the binaries are present, Latin text falls back to the system UI sans and Tamil
falls back to `Noto Sans Tamil → Latha → Nirmala UI → sans-serif`, so **Tamil always
renders**.
