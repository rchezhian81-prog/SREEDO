import type { PoolClient } from "pg";
import { query } from "../db/postgres";

/**
 * Atomically returns the next per-tenant sequence value for (institutionId, kind),
 * creating the counter on first use (migration 0105 seeds counters for existing
 * tenants). Replaces the old GLOBAL admission/employee sequences so numbering is
 * isolated per institution.
 *
 * Pass the surrounding transaction `client` when generating numbers inside a
 * transaction (e.g. bulk import): the increment then participates in that
 * transaction, so a rollback un-consumes the number and concurrent batches
 * serialise on the counter row. Without a client each call is its own atomic
 * statement (the `ON CONFLICT … DO UPDATE … RETURNING` is atomic).
 */
export async function nextTenantNumber(
  institutionId: string,
  kind: string,
  client?: PoolClient
): Promise<number> {
  const text = `
    INSERT INTO institution_sequences (institution_id, kind, current_value)
    VALUES ($1, $2, 1)
    ON CONFLICT (institution_id, kind)
    DO UPDATE SET current_value = institution_sequences.current_value + 1
    RETURNING current_value`;
  const params = [institutionId, kind];
  const { rows } = client
    ? await client.query<{ current_value: string }>(text, params)
    : await query<{ current_value: string }>(text, params);
  return Number(rows[0].current_value);
}
