# Mobile App Decision — invest / park / PWA

> PLANNING ONLY. A decision is requested; nothing is implemented by this doc.

## Current state (verified 2026-07-10)

- `mobile/` Flutter app: **39 Dart files** vs ~190 web routes — a skeleton,
  not a product. CI runs `flutter analyze` only (no build/release pipeline,
  no store presence, no push infrastructure wired to it).
- Meanwhile the web `/portal` is the real parent/student mobile surface today
  and is about to get its biggest wins (T8.1 booking, T9.1 leave).

## The honest problem

Selling "we have a mobile app" on 39 files would be a fake claim — the exact
thing this excellence programme forbids. Keeping it half-alive silently drags
the whole-product score and splits attention.

## Options

| Option | Cost | Outcome |
|---|---|---|
| **A. Invest** — build the Flutter app to portal parity | Months of parallel work; every portal feature shipped twice forever | Native feel, push notifications, store presence |
| **B. Park** — freeze `mobile/`, remove from claims | ~0 | Honest, but "no app" objection in sales |
| **C. PWA-first (recommended)** — make `/portal` installable (manifest + icons + service-worker shell), keep 360px excellence, add web-push later; park Flutter until real demand | Days, inside PX4a | "Install GoCampus on your phone" is TRUE; one codebase; store apps remain a future option |

## Recommendation

**C now, revisit A only on customer pull** (e.g. ≥3 paying tenants requesting
store apps or push-critical workflows). Concretely: (1) PX4a adds PWA manifest
+ installability to `/portal`; (2) `mobile/` stays in-repo, CI-analyzed,
explicitly labeled experimental in docs; (3) marketing says "installable
mobile portal", never "native app", until A is actually built.

**Decision owner:** product owner — please confirm C (or choose A/B) before
PX4a is scoped.
