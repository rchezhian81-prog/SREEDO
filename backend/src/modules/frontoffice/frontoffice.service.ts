import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { paginatedResponse, type Pagination } from "../../utils/pagination";
import type { z } from "zod";
import type {
  createDispatchSchema,
  updateDispatchSchema,
  listDispatchQuerySchema,
  createCallSchema,
  updateCallSchema,
  listCallQuerySchema,
} from "./frontoffice.schema";

// An optional handledBy must reference a staff (teachers) row in the same tenant.
async function assertStaff(id: string, institutionId: string): Promise<void> {
  const { rows } = await query(
    "SELECT 1 FROM teachers WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.badRequest("Invalid staff member for handledBy");
}

// ---------------------------------------------------------------------------
// Postal / Dispatch register
// ---------------------------------------------------------------------------

const DISPATCH_SELECT = `
  d.id, d.direction, d.item_type AS "itemType", d.ref_no AS "refNo",
  d.party_name AS "partyName", d.addressee, d.carrier, d.tracking_no AS "trackingNo",
  to_char(d.item_date, 'YYYY-MM-DD') AS "itemDate", d.status, d.remarks,
  d.handled_by AS "handledBy",
  CASE WHEN t.id IS NOT NULL THEN t.first_name || ' ' || t.last_name END AS "handledByName",
  d.created_at AS "createdAt", d.updated_at AS "updatedAt"
FROM postal_dispatches d
LEFT JOIN teachers t ON t.id = d.handled_by`;

export async function listDispatches(
  pagination: Pagination,
  filters: z.infer<typeof listDispatchQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["d.institution_id = $1"];
  if (filters.direction) {
    params.push(filters.direction);
    conditions.push(`d.direction = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`d.status = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(d.party_name ILIKE $${params.length} OR d.addressee ILIKE $${params.length} OR d.tracking_no ILIKE $${params.length} OR d.ref_no ILIKE $${params.length})`
    );
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`d.item_date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`d.item_date <= $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM postal_dispatches d ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${DISPATCH_SELECT} ${where}
     ORDER BY d.item_date DESC, d.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getDispatch(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${DISPATCH_SELECT} WHERE d.id = $1 AND d.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Dispatch entry not found");
  return rows[0];
}

export async function createDispatch(
  input: z.infer<typeof createDispatchSchema>,
  institutionId: string,
  userId: string
) {
  if (input.handledBy) await assertStaff(input.handledBy, institutionId);
  // Outbound items default to 'dispatched', inbound to 'received', unless set.
  const status = input.status ?? (input.direction === "outbound" ? "dispatched" : "received");
  let id: string;
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO postal_dispatches (
         institution_id, direction, item_type, ref_no, party_name, addressee,
         carrier, tracking_no, item_date, status, remarks, handled_by, created_by
       ) VALUES ($1,$2,COALESCE($3,'letter'),$4,$5,$6,$7,$8,COALESCE($9::date,CURRENT_DATE),$10,$11,$12,$13)
       RETURNING id`,
      [
        institutionId,
        input.direction,
        input.itemType ?? null,
        input.refNo ?? null,
        input.partyName,
        input.addressee ?? null,
        input.carrier ?? null,
        input.trackingNo ?? null,
        input.itemDate ?? null,
        status,
        input.remarks ?? null,
        input.handledBy ?? null,
        userId,
      ]
    );
    id = rows[0].id;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw ApiError.badRequest("A dispatch with that reference number already exists");
    }
    throw err;
  }
  return getDispatch(id, institutionId);
}

const DISPATCH_COLUMN_MAP: Record<string, string> = {
  direction: "direction",
  itemType: "item_type",
  refNo: "ref_no",
  partyName: "party_name",
  addressee: "addressee",
  carrier: "carrier",
  trackingNo: "tracking_no",
  itemDate: "item_date",
  status: "status",
  remarks: "remarks",
  handledBy: "handled_by",
};

export async function updateDispatch(
  id: string,
  input: z.infer<typeof updateDispatchSchema>,
  institutionId: string
) {
  if (input.handledBy) await assertStaff(input.handledBy, institutionId);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(DISPATCH_COLUMN_MAP)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  sets.push("updated_at = now()");
  params.push(id, institutionId);
  try {
    const { rowCount } = await query(
      `UPDATE postal_dispatches SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
      params
    );
    if (!rowCount) throw ApiError.notFound("Dispatch entry not found");
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw ApiError.badRequest("A dispatch with that reference number already exists");
    }
    throw err;
  }
  return getDispatch(id, institutionId);
}

export async function deleteDispatch(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM postal_dispatches WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Dispatch entry not found");
}

// ---------------------------------------------------------------------------
// Call register
// ---------------------------------------------------------------------------

const CALL_SELECT = `
  c.id, c.direction, c.caller_name AS "callerName", c.phone, c.purpose,
  c.related_to AS "relatedTo", to_char(c.follow_up_date, 'YYYY-MM-DD') AS "followUpDate",
  c.notes, c.handled_by AS "handledBy",
  CASE WHEN t.id IS NOT NULL THEN t.first_name || ' ' || t.last_name END AS "handledByName",
  c.call_time AS "callTime", c.created_at AS "createdAt"
FROM call_logs c
LEFT JOIN teachers t ON t.id = c.handled_by`;

export async function listCalls(
  pagination: Pagination,
  filters: z.infer<typeof listCallQuerySchema>,
  institutionId: string
) {
  const params: unknown[] = [institutionId];
  const conditions: string[] = ["c.institution_id = $1"];
  if (filters.direction) {
    params.push(filters.direction);
    conditions.push(`c.direction = $${params.length}`);
  }
  if (filters.relatedTo) {
    params.push(filters.relatedTo);
    conditions.push(`c.related_to = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(c.caller_name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.purpose ILIKE $${params.length})`
    );
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`c.call_time::date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`c.call_time::date <= $${params.length}`);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const countResult = await query<{ count: string }>(
    `SELECT count(*) FROM call_logs c ${where}`,
    params
  );
  const { rows } = await query(
    `SELECT ${CALL_SELECT} ${where}
     ORDER BY c.call_time DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  return paginatedResponse(rows, Number(countResult.rows[0].count), pagination);
}

export async function getCall(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT ${CALL_SELECT} WHERE c.id = $1 AND c.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Call entry not found");
  return rows[0];
}

export async function createCall(
  input: z.infer<typeof createCallSchema>,
  institutionId: string,
  userId: string
) {
  if (input.handledBy) await assertStaff(input.handledBy, institutionId);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO call_logs (
       institution_id, direction, caller_name, phone, purpose, related_to,
       follow_up_date, notes, handled_by, created_by
     ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,'general'),$7,$8,$9,$10)
     RETURNING id`,
    [
      institutionId,
      input.direction,
      input.callerName,
      input.phone ?? null,
      input.purpose ?? null,
      input.relatedTo ?? null,
      input.followUpDate ?? null,
      input.notes ?? null,
      input.handledBy ?? null,
      userId,
    ]
  );
  return getCall(rows[0].id, institutionId);
}

const CALL_COLUMN_MAP: Record<string, string> = {
  direction: "direction",
  callerName: "caller_name",
  phone: "phone",
  purpose: "purpose",
  relatedTo: "related_to",
  followUpDate: "follow_up_date",
  notes: "notes",
  handledBy: "handled_by",
};

export async function updateCall(
  id: string,
  input: z.infer<typeof updateCallSchema>,
  institutionId: string
) {
  if (input.handledBy) await assertStaff(input.handledBy, institutionId);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(CALL_COLUMN_MAP)) {
    const value = (input as Record<string, unknown>)[field];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  params.push(id, institutionId);
  const { rowCount } = await query(
    `UPDATE call_logs SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}`,
    params
  );
  if (!rowCount) throw ApiError.notFound("Call entry not found");
  return getCall(id, institutionId);
}

export async function deleteCall(id: string, institutionId: string): Promise<void> {
  const { rowCount } = await query(
    "DELETE FROM call_logs WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Call entry not found");
}

// ---------------------------------------------------------------------------
// Front-office summary — one tenant-scoped aggregate across all five surfaces.
// ---------------------------------------------------------------------------

export async function frontOfficeSummary(institutionId: string) {
  const { rows } = await query<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM visitor_logs   WHERE institution_id = $1 AND out_time IS NULL) AS "visitorsInside",
       (SELECT count(*) FROM feedback_entries WHERE institution_id = $1 AND status IN ('open','in_progress')) AS "openComplaints",
       (SELECT count(*) FROM lost_found_items WHERE institution_id = $1 AND status = 'open') AS "openLostFound",
       (SELECT count(*) FROM postal_dispatches WHERE institution_id = $1 AND item_date = CURRENT_DATE) AS "dispatchesToday",
       (SELECT count(*) FROM call_logs        WHERE institution_id = $1 AND call_time::date = CURRENT_DATE) AS "callsToday",
       (SELECT count(*) FROM call_logs        WHERE institution_id = $1 AND follow_up_date IS NOT NULL AND follow_up_date <= CURRENT_DATE) AS "followUpsDue"`,
    [institutionId]
  );
  const r = rows[0];
  return {
    visitorsInside: Number(r.visitorsInside),
    openComplaints: Number(r.openComplaints),
    openLostFound: Number(r.openLostFound),
    dispatchesToday: Number(r.dispatchesToday),
    callsToday: Number(r.callsToday),
    followUpsDue: Number(r.followUpsDue),
  };
}
