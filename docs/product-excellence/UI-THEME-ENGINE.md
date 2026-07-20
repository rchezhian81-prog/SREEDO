# UI Theme Engine (PR-UI2)

How the modern GoCampus skin (`.ui-v2`, shipped dormant in PR-UI1) is switched on
at runtime — and why it stays completely inert until deliberately activated.

> **State:** the engine is wired but **ships OFF**. The build master switch is
> absent in every environment, and PR-UI2 does **not** create or target the
> `ui_v2` platform flag. Nothing changes for any user until both gates below are
> deliberately turned on.

## Two-gate activation

The modern skin is effective **only when both gates agree**. Either one
false/missing ⇒ legacy UI, byte-for-byte.

| Gate | Source | Helper |
|------|--------|--------|
| 1. Build master | `NEXT_PUBLIC_UI_V2 === "true"` (build-time, off by default) | `isModernSkinRequested()` in `frontend/src/lib/ui-flag.ts` |
| 2. Tenant flag | caller's institution is `enabled` **and** explicitly allow-listed in the audited `platform_feature_flags` registry (Layer 2) | `/auth/me.uiV2Enabled` |

`shouldApplyUiV2(tenantEnabled)` is the pure AND of the two and is the single
truth-table under test (`frontend/src/lib/skin-engine.test.tsx`).

## Backend resolver (read-only, fail-safe)

`backend/src/modules/platform/feature-flag-runtime.ts`

- `evaluatePlatformFlag(row, institutionId)` — pure, DB-free: `true` **iff** the
  row exists, `status === "enabled"`, and `institutionId` is in `allowed_tenants`.
  `disabled`, `rollout`, a missing row, an empty/other allow-list, or a missing
  institution id ⇒ `false`.
- `isPlatformFeatureEnabledForTenant(institutionId, key)` — wraps the DB read in a
  60 s TTL cache and a `try/catch` that returns **`false` on any error**.
- The institution id comes **only** from the authenticated server context
  (`req.user.institutionId`, via `getProfile`); a client-supplied tenant id is
  never read.
- This module **only reads**. The single source of truth and the audited
  super-admin setter / settings-history / rollback stay in
  `platform-settings.service.ts` and are untouched — so every `ui_v2` change is
  still recorded in `platform_audit_log`.

### /auth/me contract

`getProfile` adds exactly one field:

```
uiV2Enabled: boolean   // server-derived; fail-safe false
```

No raw flag, `allowed_tenants`, or settings blob is ever exposed. Tenant
isolation and non-leakage are asserted in
`backend/tests/integration/ui-v2-flag.int.test.ts` (an allow-listed tenant A
never enables tenant B; another tenant's id never appears in the payload).

## Frontend engine

`frontend/src/stores/skin-store.ts`

- `useSkinStore` owns the one DOM side-effect — toggling the `.ui-v2` scope class
  on `<html>` — plus a one-shot `resolved` latch.
- `resolveSkin({ fetchTenantEnabled, timeoutMs = 4000 })` orchestrates the
  decision: it starts a legacy-fallback timeout (the render gate must never hang),
  awaits the injected tenant lookup, and applies the result. The **first** of
  {timeout, success, failure} to settle wins; later outcomes are ignored, so a
  session that already fell back to legacy is never re-skinned mid-flight.

### No-flash render gate

`frontend/src/app/(dashboard)/layout.tsx` holds its **existing** spinner until the
skin decision latches:

```
if (isModernSkinRequested() && !skinResolved) return <Spinner />;
```

So the first painted shell is already the correct skin. With the master switch
**off**, `isModernSkinRequested()` is `false`: the gate is inert, the resolver
never fetches, and the legacy render path is unchanged. Super-admin and
unauthenticated sessions resolve straight to legacy (the skin is tenant-scoped).

### Eligible-only light default

When — and only when — the modern skin is actually applied, a session with **no
explicit saved theme** opens in light: the engine reads (never writes) the theme
store's key and drops the boot script's `.dark`. An explicit saved `light`/`dark`
is always respected, and a later toggle still wins. Legacy / off-flag light↔dark
resolution and the no-flash boot script are never touched.

## Dormancy is still enforced

Only the three sanctioned engine files may apply the scope class:
`lib/ui-flag.ts`, `stores/skin-store.ts`, `(dashboard)/layout.tsx`. The design
guard's `ui-v2-dormant` rule now also matches the `UI_V2_CLASS` constant (not just
the literal `ui-v2`), so no other file can bypass the rule by importing the token.
Asserted in `frontend/src/design-guard.test.ts`.

## Activation checklist (a later PR — do NOT do this in PR-UI2)

1. Drop the licensed font binaries (see `frontend/public/fonts/README.md`).
2. Create the `ui_v2` flag in the audited registry via the existing super-admin
   surface; add a single pilot tenant to `allowed_tenants`; set `status = enabled`.
3. Set `NEXT_PUBLIC_UI_V2=true` for the build serving that pilot.
4. Verify the pilot tenant sees the modern skin and every other tenant is
   unchanged; watch, then widen the allow-list.

Rollback is either gate: unset the env var (all tenants) or disable / de-list the
tenant in the audited registry (recorded in `platform_audit_log`).
