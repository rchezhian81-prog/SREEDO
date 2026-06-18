import crypto from "node:crypto";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  createAllocationSchema,
  createBlockSchema,
  createHostelSchema,
  createRoomSchema,
  generateInvoicesSchema,
  setFeeSchema,
  transferSchema,
  updateBlockSchema,
  updateHostelSchema,
  updateRoomSchema,
} from "./hostel.schema";

function isUnique(err: unknown): { is: boolean; constraint?: string } {
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
    return { is: true, constraint: (err as { constraint?: string }).constraint };
  }
  return { is: false };
}

function genInvoiceNo(): string {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `HST-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function buildSets(
  map: Record<string, string>,
  input: Record<string, unknown>
): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(map)) {
    if (input[field] !== undefined) {
      params.push(input[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  return { sets, params };
}

async function assertRef(
  table: "hostels" | "hostel_blocks" | "hostel_rooms" | "students",
  id: string,
  institutionId: string,
  label: string
): Promise<void> {
  const { rows } = await query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.badRequest(`Invalid ${label}`);
}

// --- Hostels ---

export async function listHostels(institutionId: string) {
  const { rows } = await query(
    `SELECT h.id, h.name, h.code, h.type, h.address, h.warden_name AS "wardenName",
            h.warden_phone AS "wardenPhone", h.contact_phone AS "contactPhone",
            h.capacity, h.is_active AS "isActive",
            (SELECT count(*)::int FROM hostel_rooms r WHERE r.hostel_id = h.id) AS "roomCount",
            (SELECT COALESCE(sum(r.capacity), 0)::int FROM hostel_rooms r WHERE r.hostel_id = h.id) AS "bedCount",
            (SELECT count(*)::int FROM hostel_allocations a WHERE a.hostel_id = h.id AND a.status = 'active') AS "occupied"
     FROM hostels h WHERE h.institution_id = $1 ORDER BY h.name`,
    [institutionId]
  );
  return rows;
}

export async function createHostel(
  input: z.infer<typeof createHostelSchema>,
  institutionId: string
) {
  try {
    const { rows } = await query(
      `INSERT INTO hostels (institution_id, name, code, type, address, warden_name,
                            warden_phone, contact_phone, capacity, is_active)
       VALUES ($1, $2, $3, COALESCE($4, 'boys'), $5, $6, $7, $8, $9, COALESCE($10, true))
       RETURNING id, name, code, type, is_active AS "isActive"`,
      [
        institutionId,
        input.name,
        input.code,
        input.type ?? null,
        input.address ?? null,
        input.wardenName ?? null,
        input.wardenPhone ?? null,
        input.contactPhone ?? null,
        input.capacity ?? null,
        input.isActive ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err).is) throw ApiError.conflict("A hostel with that code exists");
    throw err;
  }
}

export async function updateHostel(
  id: string,
  input: z.infer<typeof updateHostelSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    {
      name: "name",
      code: "code",
      type: "type",
      address: "address",
      wardenName: "warden_name",
      wardenPhone: "warden_phone",
      contactPhone: "contact_phone",
      capacity: "capacity",
      isActive: "is_active",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE hostels SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, name, code, type, is_active AS "isActive"`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Hostel not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err).is) throw ApiError.conflict("A hostel with that code exists");
    throw err;
  }
}

export async function deleteHostel(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM hostels WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Hostel not found");
}

// --- Blocks ---

export async function listBlocks(hostelId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT id, hostel_id AS "hostelId", name FROM hostel_blocks
     WHERE hostel_id = $1 AND institution_id = $2 ORDER BY name`,
    [hostelId, institutionId]
  );
  return rows;
}

export async function createBlock(
  hostelId: string,
  input: z.infer<typeof createBlockSchema>,
  institutionId: string
) {
  await assertRef("hostels", hostelId, institutionId, "hostel");
  try {
    const { rows } = await query(
      `INSERT INTO hostel_blocks (institution_id, hostel_id, name)
       VALUES ($1, $2, $3) RETURNING id, hostel_id AS "hostelId", name`,
      [institutionId, hostelId, input.name]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err).is) throw ApiError.conflict("A block with that name exists");
    throw err;
  }
}

export async function updateBlock(
  id: string,
  input: z.infer<typeof updateBlockSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets({ name: "name" }, input as Record<string, unknown>);
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE hostel_blocks SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, hostel_id AS "hostelId", name`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Block not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err).is) throw ApiError.conflict("A block with that name exists");
    throw err;
  }
}

export async function deleteBlock(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM hostel_blocks WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Block not found");
}

// --- Rooms ---

export async function listRooms(hostelId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT r.id, r.hostel_id AS "hostelId", r.block_id AS "blockId", b.name AS "blockName",
            r.room_number AS "roomNumber", r.floor, r.room_type AS "roomType",
            r.capacity, r.status,
            count(a.id) FILTER (WHERE a.status = 'active')::int AS occupied,
            (r.capacity - count(a.id) FILTER (WHERE a.status = 'active'))::int AS "availableBeds"
     FROM hostel_rooms r
     LEFT JOIN hostel_blocks b ON b.id = r.block_id
     LEFT JOIN hostel_allocations a ON a.room_id = r.id
     WHERE r.hostel_id = $1 AND r.institution_id = $2
     GROUP BY r.id, b.name
     ORDER BY r.room_number`,
    [hostelId, institutionId]
  );
  return rows;
}

export async function createRoom(
  hostelId: string,
  input: z.infer<typeof createRoomSchema>,
  institutionId: string
) {
  await assertRef("hostels", hostelId, institutionId, "hostel");
  if (input.blockId) await assertRef("hostel_blocks", input.blockId, institutionId, "block");
  try {
    const { rows } = await query(
      `INSERT INTO hostel_rooms (institution_id, hostel_id, block_id, room_number, floor, room_type, capacity, status)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 1), COALESCE($8, 'available'))
       RETURNING id, hostel_id AS "hostelId", room_number AS "roomNumber", room_type AS "roomType", capacity, status`,
      [
        institutionId,
        hostelId,
        input.blockId ?? null,
        input.roomNumber,
        input.floor ?? null,
        input.roomType ?? null,
        input.capacity ?? null,
        input.status ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err).is) throw ApiError.conflict("A room with that number exists in the hostel");
    throw err;
  }
}

export async function updateRoom(
  id: string,
  input: z.infer<typeof updateRoomSchema>,
  institutionId: string
) {
  if (input.blockId) await assertRef("hostel_blocks", input.blockId, institutionId, "block");
  const { sets, params } = buildSets(
    {
      roomNumber: "room_number",
      blockId: "block_id",
      floor: "floor",
      roomType: "room_type",
      capacity: "capacity",
      status: "status",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE hostel_rooms SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, hostel_id AS "hostelId", room_number AS "roomNumber", room_type AS "roomType", capacity, status`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Room not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err).is) throw ApiError.conflict("A room with that number exists in the hostel");
    throw err;
  }
}

export async function deleteRoom(id: string, institutionId: string) {
  const active = await query(
    "SELECT 1 FROM hostel_allocations WHERE room_id = $1 AND institution_id = $2 AND status = 'active' LIMIT 1",
    [id, institutionId]
  );
  if (active.rows[0]) throw ApiError.conflict("Cannot delete a room with active occupants");
  const { rowCount } = await query(
    "DELETE FROM hostel_rooms WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Room not found");
}

// --- Allocations ---

export async function listAllocations(
  institutionId: string,
  filters: { hostelId?: string; roomId?: string; status?: string }
) {
  const params: unknown[] = [institutionId];
  const where = ["a.institution_id = $1"];
  if (filters.hostelId) {
    params.push(filters.hostelId);
    where.push(`a.hostel_id = $${params.length}`);
  }
  if (filters.roomId) {
    params.push(filters.roomId);
    where.push(`a.room_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`a.status = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT a.id, a.student_id AS "studentId",
            s.first_name || ' ' || s.last_name AS "studentName", s.admission_no AS "admissionNo",
            a.hostel_id AS "hostelId", h.name AS "hostelName",
            a.room_id AS "roomId", r.room_number AS "roomNumber",
            a.bed_no AS "bedNo", a.allocation_date AS "allocationDate",
            a.vacate_date AS "vacateDate", a.status
     FROM hostel_allocations a
     JOIN students s ON s.id = a.student_id
     JOIN hostels h ON h.id = a.hostel_id
     JOIN hostel_rooms r ON r.id = a.room_id
     WHERE ${where.join(" AND ")}
     ORDER BY h.name, r.room_number, s.first_name`,
    params
  );
  return rows;
}

// Locks a room and verifies it can take another occupant; returns its hostel.
async function reserveRoom(
  client: import("pg").PoolClient,
  roomId: string,
  institutionId: string,
  expectedHostelId?: string
): Promise<{ hostelId: string }> {
  const r = await client.query<{
    hostel_id: string;
    capacity: number;
    status: string;
  }>(
    "SELECT hostel_id, capacity, status FROM hostel_rooms WHERE id = $1 AND institution_id = $2 FOR UPDATE",
    [roomId, institutionId]
  );
  const room = r.rows[0];
  if (!room) throw ApiError.badRequest("Invalid room");
  if (expectedHostelId && room.hostel_id !== expectedHostelId)
    throw ApiError.badRequest("Room does not belong to the hostel");
  if (room.status === "maintenance" || room.status === "inactive")
    throw ApiError.conflict(`Room is ${room.status}`);
  const occupied = await client.query<{ count: string }>(
    "SELECT count(*)::int AS count FROM hostel_allocations WHERE room_id = $1 AND status = 'active'",
    [roomId]
  );
  if (Number(occupied.rows[0].count) >= room.capacity)
    throw ApiError.conflict("Room is full");
  return { hostelId: room.hostel_id };
}

function allocationConflict(err: unknown): never {
  const u = isUnique(err);
  if (u.is && u.constraint?.includes("bed"))
    throw ApiError.conflict("That bed is already occupied");
  if (u.is) throw ApiError.conflict("That student already has an active allocation");
  throw err as Error;
}

export async function createAllocation(
  input: z.infer<typeof createAllocationSchema>,
  institutionId: string
) {
  await assertRef("students", input.studentId, institutionId, "student");
  await assertRef("hostels", input.hostelId, institutionId, "hostel");
  return withTransaction(async (client) => {
    await reserveRoom(client, input.roomId, institutionId, input.hostelId);
    try {
      const { rows } = await client.query(
        `INSERT INTO hostel_allocations (institution_id, student_id, hostel_id, room_id, bed_no, allocation_date)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE))
         RETURNING id, student_id AS "studentId", hostel_id AS "hostelId", room_id AS "roomId",
                   bed_no AS "bedNo", status`,
        [institutionId, input.studentId, input.hostelId, input.roomId, input.bedNo ?? null, input.allocationDate ?? null]
      );
      return rows[0];
    } catch (err) {
      allocationConflict(err);
    }
  });
}

export async function transferAllocation(
  id: string,
  input: z.infer<typeof transferSchema>,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const cur = await client.query<{ student_id: string }>(
      "SELECT student_id FROM hostel_allocations WHERE id = $1 AND institution_id = $2 AND status = 'active' FOR UPDATE",
      [id, institutionId]
    );
    if (!cur.rows[0]) throw ApiError.notFound("Active allocation not found");
    // Close the current allocation first so it frees its bed/room for counting.
    await client.query(
      "UPDATE hostel_allocations SET status = 'transferred', vacate_date = CURRENT_DATE WHERE id = $1",
      [id]
    );
    const { hostelId } = await reserveRoom(client, input.roomId, institutionId);
    try {
      const { rows } = await client.query(
        `INSERT INTO hostel_allocations (institution_id, student_id, hostel_id, room_id, bed_no)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, student_id AS "studentId", hostel_id AS "hostelId", room_id AS "roomId",
                   bed_no AS "bedNo", status`,
        [institutionId, cur.rows[0].student_id, hostelId, input.roomId, input.bedNo ?? null]
      );
      return rows[0];
    } catch (err) {
      allocationConflict(err);
    }
  });
}

export async function vacateAllocation(id: string, institutionId: string) {
  const { rows } = await query(
    `UPDATE hostel_allocations SET status = 'vacated', vacate_date = CURRENT_DATE
     WHERE id = $1 AND institution_id = $2 AND status = 'active'
     RETURNING id, status, vacate_date AS "vacateDate"`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Active allocation not found");
  return rows[0];
}

export async function deleteAllocation(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM hostel_allocations WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Allocation not found");
}

// --- Hostel fees ---

export async function listFees(institutionId: string, hostelId?: string) {
  const params: unknown[] = [institutionId];
  let where = "f.institution_id = $1";
  if (hostelId) {
    params.push(hostelId);
    where += ` AND f.hostel_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT f.id, f.hostel_id AS "hostelId", h.name AS "hostelName",
            f.room_type AS "roomType", f.amount, f.frequency
     FROM hostel_fees f JOIN hostels h ON h.id = f.hostel_id
     WHERE ${where} ORDER BY h.name, f.room_type NULLS FIRST`,
    params
  );
  return rows;
}

export async function setFee(
  input: z.infer<typeof setFeeSchema>,
  institutionId: string
) {
  await assertRef("hostels", input.hostelId, institutionId, "hostel");
  const conflictTarget = input.roomType
    ? "(institution_id, hostel_id, room_type) WHERE room_type IS NOT NULL"
    : "(institution_id, hostel_id) WHERE room_type IS NULL";
  const { rows } = await query(
    `INSERT INTO hostel_fees (institution_id, hostel_id, room_type, amount, frequency)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'monthly'))
     ON CONFLICT ${conflictTarget}
     DO UPDATE SET amount = EXCLUDED.amount, frequency = EXCLUDED.frequency
     RETURNING id, hostel_id AS "hostelId", room_type AS "roomType", amount, frequency`,
    [institutionId, input.hostelId, input.roomType ?? null, input.amount, input.frequency ?? null]
  );
  return rows[0];
}

export async function deleteFee(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM hostel_fees WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Fee not found");
}

/**
 * Generates hostel-fee invoices for active allocations (optionally one hostel).
 * Room-type fee overrides the hostel fee. Idempotent per student+period.
 */
export async function generateInvoices(
  input: z.infer<typeof generateInvoicesSchema>,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const params: unknown[] = [institutionId];
    let where = "a.institution_id = $1 AND a.status = 'active'";
    if (input.hostelId) {
      params.push(input.hostelId);
      where += ` AND a.hostel_id = $${params.length}`;
    }
    const { rows: allocations } = await client.query<{
      student_id: string;
      hostel_id: string;
      room_type: string | null;
      hostel_name: string;
    }>(
      `SELECT a.student_id, a.hostel_id, r.room_type, h.name AS hostel_name
       FROM hostel_allocations a
       JOIN hostel_rooms r ON r.id = a.room_id
       JOIN hostels h ON h.id = a.hostel_id
       WHERE ${where}`,
      params
    );

    const { rows: fees } = await client.query<{
      hostel_id: string;
      room_type: string | null;
      amount: string;
    }>("SELECT hostel_id, room_type, amount FROM hostel_fees WHERE institution_id = $1", [
      institutionId,
    ]);
    const hostelFee = new Map<string, string>();
    const roomTypeFee = new Map<string, string>();
    for (const f of fees) {
      if (f.room_type) roomTypeFee.set(`${f.hostel_id}|${f.room_type}`, f.amount);
      else hostelFee.set(f.hostel_id, f.amount);
    }

    let generated = 0;
    let skipped = 0;
    for (const a of allocations) {
      const amount =
        (a.room_type && roomTypeFee.get(`${a.hostel_id}|${a.room_type}`)) ||
        hostelFee.get(a.hostel_id);
      if (amount === undefined) {
        skipped++;
        continue;
      }
      const existing = await client.query(
        "SELECT 1 FROM hostel_invoices WHERE institution_id = $1 AND student_id = $2 AND period = $3",
        [institutionId, a.student_id, input.period]
      );
      if (existing.rows[0]) {
        skipped++;
        continue;
      }
      const description = input.description ?? `Hostel fee — ${a.hostel_name} (${input.period})`;
      const inv = await client.query<{ id: string }>(
        `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [institutionId, genInvoiceNo(), a.student_id, description, amount, input.dueDate]
      );
      await client.query(
        `INSERT INTO hostel_invoices (institution_id, invoice_id, hostel_id, student_id, period)
         VALUES ($1, $2, $3, $4, $5)`,
        [institutionId, inv.rows[0].id, a.hostel_id, a.student_id, input.period]
      );
      generated++;
    }
    return { generated, skipped };
  });
}

// --- Portal (owner-scoped) ---

/** A student's active hostel allocation with hostel/room/bed detail. */
export async function studentAllocation(studentId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT a.id, a.bed_no AS "bedNo", a.allocation_date AS "allocationDate", a.status,
            h.name AS "hostelName", h.type AS "hostelType",
            r.room_number AS "roomNumber", r.floor, r.room_type AS "roomType",
            h.warden_name AS "wardenName", h.warden_phone AS "wardenPhone"
     FROM hostel_allocations a
     JOIN hostels h ON h.id = a.hostel_id
     JOIN hostel_rooms r ON r.id = a.room_id
     WHERE a.student_id = $1 AND a.institution_id = $2 AND a.status = 'active'`,
    [studentId, institutionId]
  );
  return rows[0] ?? null;
}
