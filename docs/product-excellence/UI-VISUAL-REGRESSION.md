# Shell Visual Regression (PR-UI3)

A deterministic Playwright screenshot suite that guards the **staff shell** —
UI-v2 light, UI-v2 dark, and legacy/off-flag — against unintended visual drift.
It is separate from the functional e2e suite and does not replace the
functional/accessibility tests.

## What it captures
| State | Desktop 1440×900 | Tablet 820×1180 | Mobile 390×844 |
|---|---|---|---|
| UI-v2 light (Modern Soft Premium) | ✔ | ✔ | ✔ (no-regression) |
| UI-v2 dark (Intelligent Glass) | ✔ | ✔ | ✔ (no-regression) |
| Legacy / off-flag | ✔ | ✔ | ✔ (no-regression) |

Only the **shell** (sidebar + header) is compared — the page content
(`#main-content`) is masked, because content redesigns are out of PR-UI3 scope.
Mobile is a no-regression check of the existing layout, not a redesign.

## Determinism (no flakiness, no production/personal data)
- **Pinned browser + OS + fonts:** CI runs inside `mcr.microsoft.com/playwright:v1.51.1-noble`,
  the same image the committed baselines were generated in, so rendering matches
  byte-for-byte. (Baselines carry the `-linux` platform suffix.)
- **All network mocked:** `e2e/visual/fixtures.ts` stubs every shell/page API call
  (`/auth/me`, `/auth/permissions`, `/branding`, `/academic-years`, unread-count,
  dashboard summary, search) with fixed shapes. The session is a synthetic
  `Demo Staff` account — **no** production or real personal data.
- **One build, three states:** the app is built once with `NEXT_PUBLIC_UI_V2=true`
  (master ON); the mocked `uiV2Enabled` toggles UI-v2 vs legacy, and the saved
  `gocampus-theme` toggles light vs dark.
- **Animations disabled**, `reducedMotion: reduce`, `deviceScaleFactor: 1`, fixed
  timezone/locale; the run waits for `document.fonts.ready` and for the skin class
  to latch before shooting. A small `maxDiffPixelRatio: 0.01` absorbs sub-pixel
  antialiasing while still failing on material colour/layout/spacing drift.

## Files
- `frontend/playwright.visual.config.ts` — config, viewports, `webServer`
  (`build:visual` + `start:visual` on port 3210).
- `frontend/e2e/visual/shell.visual.spec.ts` — the three states × three viewports.
- `frontend/e2e/visual/fixtures.ts` — the fixed session + API stubs.
- `frontend/e2e/visual/shell.visual.spec.ts-snapshots/` — the committed baselines.
- CI job **“Visual (shell)”** in `.github/workflows/ci.yml` — runs in the pinned
  container, `npm ci` → `npm run test:visual`, **fails on material drift**, and
  uploads a diff artifact on failure.

## Running locally
```
cd frontend
npm run test:visual            # compare against committed baselines
```
For byte-identical results without local browser/font drift, run inside the same
image the baselines were made in:
```
docker run --rm --ipc=host -v "$PWD":/work -w /work -e CI=1 \
  mcr.microsoft.com/playwright:v1.51.1-noble \
  sh -lc "npm ci && npm run test:visual"
```

## Intentional baseline updates
Baselines change **only** on a deliberate, reviewed shell change. Regenerate them
in the pinned image (so they match CI), review the resulting PNGs, and commit:
```
docker run --rm --ipc=host -v "$PWD":/work -w /work -e CI=1 \
  mcr.microsoft.com/playwright:v1.51.1-noble \
  sh -lc "npm ci && npm run test:visual:update"
git add frontend/e2e/visual/**/*.png   # review the diff before committing
```
Never update baselines to “make CI pass” without confirming the change is
intended — that is the one way this guard can be defeated.
