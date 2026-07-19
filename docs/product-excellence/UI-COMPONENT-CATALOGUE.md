# UI Component Catalogue (PR-UI1)

Scope of PR-UI1: the **centralized shared primitives** only. Their public APIs are
unchanged; they retheme automatically under `.ui-v2` because they consume semantic
tokens. StatCard / Table / Tabs consolidation and any page work are **deferred**.

## Primitives touched

| File | Primitive(s) | PR-UI1 change | Off-flag |
|------|--------------|---------------|----------|
| `components/ui.tsx` | Button, Input, Select, Textarea, Field, Card, Badge, Modal, ConfirmDialog, Drawer, PageHeader, Spinner, EmptyState, ErrorNote, SkipLink | Button primary/danger shadows → `var(--shadow-accent/-danger)`; `ErrorNote` `dark:text-red-400` → `text-danger` | identical |
| `components/charts.tsx` | BarChart, LineChart, DonutChart | `DONUT_COLORS` hex → `rgb(var(--chart-N))`; bar/line inherit var-backed brand | identical |
| `components/icons.tsx` | `Icon` (Lucide facade) | **none** — icons inherit `currentColor`, so they retheme for free | identical |
| `components/toast.tsx` | `toast`, `Toaster` | **none** — tones are theme-invariant solids with white text; routing them through the flipping status tokens would fail white-on-light-green contrast under the dark skin. Toasts still pick up the new type family under `.ui-v2`. | identical |

## How each primitive rethemes under `.ui-v2`

- **Surfaces/text/lines** (`Card`, `Modal`, `Drawer`, `Field`, `Input`, `EmptyState`,
  `PageHeader`): already token-driven (`bg-surface`, `text-ink`, `border-line`,
  `bg-hover`) → retheme via the `.ui-v2` variable overrides.
- **Primary action** (`Button` primary, focus rings, `Spinner`): `brand-*` is now
  variable-backed → violet under `.ui-v2`.
- **Status** (`Badge`, `ErrorNote` text): `success/warn/danger/info` tokens.
- **Charts**: `--chart-*` series + var-backed `brand`.
- **Elevation**: `shadow-card/pop/float` → `--elevation-*`.

## Dark-override baseline

Across the four primitive files there was exactly **one** `dark:` override
(`ErrorNote`'s `dark:text-red-400`), now removed via `text-danger` → **1 → 0**. The
238 `dark:` utilities across 92 pages are **out of scope** and were not touched.

## Glass (allow-listed, opt-in)

`.glass-panel` frosts a surface **only** under `.ui-v2` and **only** on navigation,
dashboard, AI and analytics surfaces — never forms or tables (use `.glass-solid` to
opt a nested panel out). Enforced by the design guard.
