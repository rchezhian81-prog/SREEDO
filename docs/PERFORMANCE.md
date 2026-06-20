# Performance / Load Testing

A small, CI-safe load-testing suite for the backend's hot endpoints, built on
[`autocannon`](https://github.com/mcollina/autocannon) (an npm dependency — no
external binary). It lives in [`backend/perf/`](../backend/perf) and is **never run
during normal CI** (CI only *validates* the config so it can't rot); the actual load
test is a manual step you run locally or against staging.

## What's in the suite

| File | Purpose |
|------|---------|
| `perf/scenarios.ts` | The hot-endpoint scenarios + per-scenario P95 budgets (pure data). |
| `perf/config.ts` | Env-driven runtime config (base URL, credentials, connections, duration). |
| `perf/run.ts` | Logs in, drives each scenario with autocannon, gates P95, prints results + cache deltas. |
| `perf/validate.ts` | CI-safe check of the scenario/config (no network, no DB). |
| `perf/seed-perf.ts` | Bulk "seed scale" data generator (multiple institutions, students, staff, attendance, fees, homework). |

### npm scripts (run from `backend/`)

- `npm run perf:validate` — typecheck the suite + validate the scenarios. **Runs in CI.** No server needed.
- `npm run perf:seed` — generate seed-scale data into the database `DATABASE_URL` points at.
- `npm run perf` — run the load test against a live server.

## Hot endpoints covered

login/auth, dashboard stats, students list, staff list, attendance summary,
fees/dues summary, Reports Center, timetable reads, RBAC catalogue + role matrix.
(The parent/student **portal** uses cookie auth; load-test it manually with a portal
session — it is documented here but not part of the bearer-token run.)

## Performance targets

- **P95 < 300 ms** for cached hot **read** endpoints at seeded scale.
- No abnormal error spike (the runner fails a scenario on any connection error /
  timeout, or a non-2xx rate ≥ 1%).
- No request crashes.

The runner gates on autocannon's **p97.5** latency, which is **≥ p95** — so passing the
gate guarantees the P95 target is met (a deliberately conservative check). `auth:login`
is **informational, not gated**: its latency is bcrypt-bound by design (a security cost,
not a system bottleneck) and is naturally high under heavy concurrency.

## How to run locally

```bash
cd backend

# 1. Point at a DISPOSABLE database and load seed-scale data.
createdb sreedo_perf   # or your own provisioning
DATABASE_URL=postgresql://USER:PASS@localhost:5432/sreedo_perf npm run perf:seed
#   tune volume: PERF_INSTITUTIONS, PERF_STUDENTS, PERF_TEACHERS, PERF_CLASSES,
#   PERF_ATTENDANCE_DAYS (defaults: 2 / 400 / 40 / 6 / 3)

# 2. Start the API against that database (high rate limits so the test isn't throttled).
DATABASE_URL=postgresql://USER:PASS@localhost:5432/sreedo_perf \
JWT_ACCESS_SECRET=local-not-dev JWT_REFRESH_SECRET=local-not-dev \
PORT=4000 RATE_LIMIT_MAX=1000000 AUTH_RATE_LIMIT_MAX=1000000 \
npm run dev

# 3. In another shell, run the suite. seed-perf prints these credentials.
PERF_BASE_URL=http://localhost:4000/api/v1 \
PERF_STAFF_EMAIL=perfadmin1@sreedo.edu PERF_STAFF_PASSWORD=Perf@12345 \
PERF_SUPER_EMAIL=perfsuper@sreedo.edu PERF_SUPER_PASSWORD=Perf@12345 \
PERF_CONNECTIONS=10 PERF_DURATION=10 npm run perf
```

Runner env: `PERF_CONNECTIONS` (default 10), `PERF_DURATION` seconds (default 10),
`PERF_WARMUP` (default on — one priming request so a cached endpoint's first hit isn't a
miss), `PERF_SOFT=true` (report breaches without a non-zero exit).

## How to run against staging

Point `PERF_BASE_URL` at the staging API and use **staging credentials** (a seeded
staff admin + super admin). Do **not** run `perf:seed` against a shared/production
database — only against a disposable one. Keep `PERF_CONNECTIONS` modest against shared
infra. Example:

```bash
PERF_BASE_URL=https://staging.example.com/api/v1 \
PERF_STAFF_EMAIL=… PERF_STAFF_PASSWORD=… \
PERF_SUPER_EMAIL=… PERF_SUPER_PASSWORD=… \
PERF_CONNECTIONS=10 PERF_DURATION=20 npm run perf
```

## How to read the results

```
scenario          cache  p50   p90   p95~  p99   req/s  non2xx  err  budget
dashboard:stats   yes    5ms   8ms   10ms  12ms  1547   0       0    300ms   PASS
students:list     no     11ms  15ms  17ms  19ms  805    0       0    300ms   PASS
auth:login        no     1065ms …     1482ms …   8      0       0    1500ms  INFO
```

- **p95~** is the gated metric (autocannon p97.5 ≥ p95). **PASS** = within budget with no
  errors; **FAIL** = over budget or errors; **INFO** = measured but not gated (login).
- **req/s** is sustained throughput at the configured concurrency.
- **Cache during run** shows `cache_hits_total` / `cache_misses_total` deltas pulled from
  `/observability/metrics`, confirming the cache is serving hot reads. Request duration and
  error counters are likewise visible on `/observability/metrics` and `/observability/overview`.

### Reference run (seed scale: 2 institutions × 200 students, 10 connections, 5 s, single dev container)

All cached/read endpoints landed **6–24 ms P95**, far under the 300 ms budget, with
~700–1,600 req/s and **zero** errors; the cache served ~21k hits with 3 misses during the
run. `auth:login` was ~1.5 s p97.5 (bcrypt-bound, informational). **9/9 gated scenarios
within budget.**

## What this means for a single-VPS deployment

The hot read paths are comfortably within budget on a single node, helped by the
short-TTL in-process cache (dashboard stats, RBAC catalogue/matrix) and indexed,
tenant-scoped queries. Throughput is bounded mainly by Postgres and CPU.

- **Login throughput** is intentionally limited by bcrypt — scale it with CPU, and avoid
  treating its latency as a cache/query problem.
- Watch `/observability/overview`: rising `avgDurationMs`, a climbing 5xx rate, or growing
  `jobs_queue_depth` are the early signals to investigate.

## When read replicas may be needed

This PR does **not** add read replicas (and on a single VPS they're usually premature).
Consider them only when, at realistic production scale, you observe: read P95 creeping
toward/over budget despite caching and indexes; Postgres CPU/IO saturated by **read**
traffic; or read load competing with writes. At that point, route heavy read endpoints
(dashboards, reports, list views) to a replica while keeping writes on the primary. Until
those signals appear, vertical scaling + the existing cache are the simpler levers.
