import { afterAll, beforeAll } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { pool } from "../../src/db/postgres";

// Bring the schema up to date once per test file, and close the pool at the end
// so the process exits cleanly.
beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await pool.end();
});
