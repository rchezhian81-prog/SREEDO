import { defineConfig } from "vitest/config";

// Integration tests: drive the real Express app (Supertest) against a real
// PostgreSQL. Requires DATABASE_URL to point at a disposable test database;
// migrations run automatically in the setup file. Files run serially so they
// don't clobber each other's data.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.int.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    fileParallelism: false,
    // Generous timeouts: these are DB-heavy tests (real Postgres, many round
    // trips each) and shared CI runners occasionally exhibit pathological I/O
    // (Postgres checkpoints stalling for >100s), which would otherwise blow a
    // tight timeout and flake a run even though the code is correct. Locally
    // each test is ~1s; 60s gives ample headroom without masking a true hang.
    hookTimeout: 60_000,
    testTimeout: 60_000,
    env: {
      // High limits so the many requests a run makes don't trip rate limiting.
      RATE_LIMIT_MAX: "100000",
      AUTH_RATE_LIMIT_MAX: "100000",
      // Low per-tenant cap so the B3 /ext rate-limit test can trip it quickly.
      // Only /ext uses this limiter and every test uses a fresh institution id,
      // so a low value never affects other suites.
      TENANT_RATE_LIMIT_MAX: "5",
    },
  },
});
