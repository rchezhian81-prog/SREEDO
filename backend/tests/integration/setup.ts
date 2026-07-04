import { afterAll, beforeAll } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { pool, query } from "../../src/db/postgres";

// This file is loaded ONLY by vitest.integration.config.ts, so it always runs
// against a disposable test database (never production).
//
// Make that throwaway database fast: disable fsync / full-page-writes /
// synchronous-commit so checkpoints don't stall. On shared CI runners the
// default (durable) Postgres can spend 80-176s in a single checkpoint fsync
// under I/O contention, which stalls the many DB round-trips these integration
// tests make and blows the per-test timeout — a pure-infrastructure flake, since
// the same suite is green locally. Durability is irrelevant for a database we
// throw away after the run, so turning it off is safe and removes the flake at
// the source. Best-effort: needs superuser (true for the CI `postgres` image
// user and a local test cluster); if not permitted, we simply run at normal
// speed.
async function makeTestDbFast(): Promise<void> {
  try {
    await query("ALTER SYSTEM SET fsync = 'off'");
    await query("ALTER SYSTEM SET full_page_writes = 'off'");
    await query("ALTER SYSTEM SET synchronous_commit = 'off'");
    await query("SELECT pg_reload_conf()");
  } catch {
    // Not a superuser (or a managed PG that forbids ALTER SYSTEM) — harmless;
    // the tests still run correctly, just without the speed-up.
  }
}

// Bring the schema up to date once per test file, and close the pool at the end
// so the process exits cleanly.
beforeAll(async () => {
  await makeTestDbFast();
  await runMigrations();
});

afterAll(async () => {
  await pool.end();
});
