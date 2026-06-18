import crypto from "node:crypto";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type {
  createAllocationSchema,
  createDriverSchema,
  createRouteSchema,
  createStopSchema,
  createTripSchema,
  createVehicleSchema,
  generateInvoicesSchema,
  setFeeSchema,
  updateAllocationSchema,
  updateDriverSchema,
  updateRouteSchema,
  updateStopSchema,
  updateTripSchema,
  updateVehicleSchema,
} from "./transport.schema";

function isUnique(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

function genInvoiceNo(): string {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `TRP-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
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
  table: "vehicles" | "drivers" | "transport_routes" | "route_stops" | "students",
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

// --- Vehicles ---

export async function listVehicles(institutionId: string) {
  const { rows } = await query(
    `SELECT v.id, v.registration_no AS "registrationNo", v.type, v.capacity,
            v.insurance_expiry AS "insuranceExpiry", v.fitness_expiry AS "fitnessExpiry",
            v.permit_expiry AS "permitExpiry", v.is_active AS "isActive",
            (SELECT count(*)::int FROM transport_routes r WHERE r.vehicle_id = v.id) AS "routeCount"
     FROM vehicles v WHERE v.institution_id = $1 ORDER BY v.registration_no`,
    [institutionId]
  );
  return rows;
}

export async function createVehicle(
  input: z.infer<typeof createVehicleSchema>,
  institutionId: string
) {
  try {
    const { rows } = await query(
      `INSERT INTO vehicles (institution_id, registration_no, type, capacity,
                             insurance_expiry, fitness_expiry, permit_expiry, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true))
       RETURNING id, registration_no AS "registrationNo", type, capacity, is_active AS "isActive"`,
      [
        institutionId,
        input.registrationNo,
        input.type ?? null,
        input.capacity ?? null,
        input.insuranceExpiry ?? null,
        input.fitnessExpiry ?? null,
        input.permitExpiry ?? null,
        input.isActive ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A vehicle with that registration exists");
    throw err;
  }
}

export async function updateVehicle(
  id: string,
  input: z.infer<typeof updateVehicleSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    {
      registrationNo: "registration_no",
      type: "type",
      capacity: "capacity",
      insuranceExpiry: "insurance_expiry",
      fitnessExpiry: "fitness_expiry",
      permitExpiry: "permit_expiry",
      isActive: "is_active",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE vehicles SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, registration_no AS "registrationNo", type, capacity, is_active AS "isActive"`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Vehicle not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A vehicle with that registration exists");
    throw err;
  }
}

export async function deleteVehicle(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM vehicles WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Vehicle not found");
}

// --- Drivers ---

export async function listDrivers(institutionId: string) {
  const { rows } = await query(
    `SELECT d.id, d.name, d.phone, d.license_number AS "licenseNumber",
            d.license_expiry AS "licenseExpiry", d.helper_name AS "helperName",
            d.helper_phone AS "helperPhone", d.is_active AS "isActive",
            (SELECT count(*)::int FROM transport_routes r WHERE r.driver_id = d.id) AS "routeCount"
     FROM drivers d WHERE d.institution_id = $1 ORDER BY d.name`,
    [institutionId]
  );
  return rows;
}

export async function createDriver(
  input: z.infer<typeof createDriverSchema>,
  institutionId: string
) {
  const { rows } = await query(
    `INSERT INTO drivers (institution_id, name, phone, license_number, license_expiry,
                          helper_name, helper_phone, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, true))
     RETURNING id, name, phone, license_number AS "licenseNumber", is_active AS "isActive"`,
    [
      institutionId,
      input.name,
      input.phone ?? null,
      input.licenseNumber ?? null,
      input.licenseExpiry ?? null,
      input.helperName ?? null,
      input.helperPhone ?? null,
      input.isActive ?? null,
    ]
  );
  return rows[0];
}

export async function updateDriver(
  id: string,
  input: z.infer<typeof updateDriverSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    {
      name: "name",
      phone: "phone",
      licenseNumber: "license_number",
      licenseExpiry: "license_expiry",
      helperName: "helper_name",
      helperPhone: "helper_phone",
      isActive: "is_active",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE drivers SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, name, phone, license_number AS "licenseNumber", is_active AS "isActive"`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Driver not found");
  return rows[0];
}

export async function deleteDriver(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM drivers WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Driver not found");
}

// --- Routes ---

export async function listRoutes(institutionId: string) {
  const { rows } = await query(
    `SELECT r.id, r.name, r.code, r.is_active AS "isActive",
            r.vehicle_id AS "vehicleId", v.registration_no AS "vehicleNo",
            r.driver_id AS "driverId", d.name AS "driverName",
            (SELECT count(*)::int FROM route_stops s WHERE s.route_id = r.id) AS "stopCount",
            (SELECT count(*)::int FROM student_transport st WHERE st.route_id = r.id AND st.status = 'active') AS "studentCount"
     FROM transport_routes r
     LEFT JOIN vehicles v ON v.id = r.vehicle_id
     LEFT JOIN drivers d ON d.id = r.driver_id
     WHERE r.institution_id = $1 ORDER BY r.name`,
    [institutionId]
  );
  return rows;
}

export async function createRoute(
  input: z.infer<typeof createRouteSchema>,
  institutionId: string
) {
  if (input.vehicleId) await assertRef("vehicles", input.vehicleId, institutionId, "vehicle");
  if (input.driverId) await assertRef("drivers", input.driverId, institutionId, "driver");
  try {
    const { rows } = await query(
      `INSERT INTO transport_routes (institution_id, name, code, vehicle_id, driver_id, is_active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
       RETURNING id, name, code, vehicle_id AS "vehicleId", driver_id AS "driverId", is_active AS "isActive"`,
      [institutionId, input.name, input.code, input.vehicleId ?? null, input.driverId ?? null, input.isActive ?? null]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A route with that code exists");
    throw err;
  }
}

export async function updateRoute(
  id: string,
  input: z.infer<typeof updateRouteSchema>,
  institutionId: string
) {
  if (input.vehicleId) await assertRef("vehicles", input.vehicleId, institutionId, "vehicle");
  if (input.driverId) await assertRef("drivers", input.driverId, institutionId, "driver");
  const { sets, params } = buildSets(
    { name: "name", code: "code", vehicleId: "vehicle_id", driverId: "driver_id", isActive: "is_active" },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE transport_routes SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, name, code, vehicle_id AS "vehicleId", driver_id AS "driverId", is_active AS "isActive"`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Route not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A route with that code exists");
    throw err;
  }
}

export async function deleteRoute(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM transport_routes WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Route not found");
}

// --- Stops ---

export async function listStops(routeId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT id, route_id AS "routeId", name, stop_order AS "stopOrder",
            pickup_time AS "pickupTime", drop_time AS "dropTime",
            distance_km AS "distanceKm", zone
     FROM route_stops WHERE route_id = $1 AND institution_id = $2
     ORDER BY stop_order, name`,
    [routeId, institutionId]
  );
  return rows;
}

export async function createStop(
  routeId: string,
  input: z.infer<typeof createStopSchema>,
  institutionId: string
) {
  await assertRef("transport_routes", routeId, institutionId, "route");
  try {
    const { rows } = await query(
      `INSERT INTO route_stops (institution_id, route_id, name, stop_order, pickup_time, drop_time, distance_km, zone)
       VALUES ($1, $2, $3, COALESCE($4, 0), $5, $6, $7, $8)
       RETURNING id, route_id AS "routeId", name, stop_order AS "stopOrder",
                 pickup_time AS "pickupTime", drop_time AS "dropTime", distance_km AS "distanceKm", zone`,
      [
        institutionId,
        routeId,
        input.name,
        input.stopOrder ?? null,
        input.pickupTime ?? null,
        input.dropTime ?? null,
        input.distanceKm ?? null,
        input.zone ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A stop with that name exists on the route");
    throw err;
  }
}

export async function updateStop(
  id: string,
  input: z.infer<typeof updateStopSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    {
      name: "name",
      stopOrder: "stop_order",
      pickupTime: "pickup_time",
      dropTime: "drop_time",
      distanceKm: "distance_km",
      zone: "zone",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE route_stops SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, route_id AS "routeId", name, stop_order AS "stopOrder",
                 pickup_time AS "pickupTime", drop_time AS "dropTime", distance_km AS "distanceKm", zone`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Stop not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A stop with that name exists on the route");
    throw err;
  }
}

export async function deleteStop(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM route_stops WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Stop not found");
}

// --- Student allocations ---

export async function listAllocations(
  institutionId: string,
  filters: { routeId?: string; stopId?: string }
) {
  const params: unknown[] = [institutionId];
  const where = ["st.institution_id = $1"];
  if (filters.routeId) {
    params.push(filters.routeId);
    where.push(`st.route_id = $${params.length}`);
  }
  if (filters.stopId) {
    params.push(filters.stopId);
    where.push(`st.stop_id = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT st.id, st.student_id AS "studentId",
            s.first_name || ' ' || s.last_name AS "studentName", s.admission_no AS "admissionNo",
            st.route_id AS "routeId", r.name AS "routeName",
            st.stop_id AS "stopId", rs.name AS "stopName",
            st.trip_type AS "tripType", st.effective_date AS "effectiveDate", st.status
     FROM student_transport st
     JOIN students s ON s.id = st.student_id
     JOIN transport_routes r ON r.id = st.route_id
     LEFT JOIN route_stops rs ON rs.id = st.stop_id
     WHERE ${where.join(" AND ")}
     ORDER BY r.name, s.first_name, s.last_name`,
    params
  );
  return rows;
}

async function assertStopOnRoute(
  stopId: string,
  routeId: string,
  institutionId: string
): Promise<void> {
  const { rows } = await query(
    "SELECT 1 FROM route_stops WHERE id = $1 AND route_id = $2 AND institution_id = $3",
    [stopId, routeId, institutionId]
  );
  if (!rows[0]) throw ApiError.badRequest("Stop does not belong to the route");
}

export async function createAllocation(
  input: z.infer<typeof createAllocationSchema>,
  institutionId: string
) {
  await assertRef("students", input.studentId, institutionId, "student");
  await assertRef("transport_routes", input.routeId, institutionId, "route");
  if (input.stopId) await assertStopOnRoute(input.stopId, input.routeId, institutionId);
  try {
    const { rows } = await query(
      `INSERT INTO student_transport (institution_id, student_id, route_id, stop_id, trip_type, effective_date, status)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'both'), COALESCE($6::date, CURRENT_DATE), COALESCE($7, 'active'))
       RETURNING id, student_id AS "studentId", route_id AS "routeId", stop_id AS "stopId",
                 trip_type AS "tripType", status`,
      [
        institutionId,
        input.studentId,
        input.routeId,
        input.stopId ?? null,
        input.tripType ?? null,
        input.effectiveDate ?? null,
        input.status ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("That student already has a transport allocation");
    throw err;
  }
}

export async function updateAllocation(
  id: string,
  input: z.infer<typeof updateAllocationSchema>,
  institutionId: string
) {
  // Resolve the target route (new or existing) to validate the stop against it.
  if (input.stopId) {
    let routeId = input.routeId;
    if (!routeId) {
      const cur = await query<{ route_id: string }>(
        "SELECT route_id FROM student_transport WHERE id = $1 AND institution_id = $2",
        [id, institutionId]
      );
      if (!cur.rows[0]) throw ApiError.notFound("Allocation not found");
      routeId = cur.rows[0].route_id;
    } else {
      await assertRef("transport_routes", routeId, institutionId, "route");
    }
    await assertStopOnRoute(input.stopId, routeId, institutionId);
  } else if (input.routeId) {
    await assertRef("transport_routes", input.routeId, institutionId, "route");
  }
  const { sets, params } = buildSets(
    {
      routeId: "route_id",
      stopId: "stop_id",
      tripType: "trip_type",
      effectiveDate: "effective_date",
      status: "status",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE student_transport SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, student_id AS "studentId", route_id AS "routeId", stop_id AS "stopId",
               trip_type AS "tripType", status`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Allocation not found");
  return rows[0];
}

export async function deleteAllocation(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM student_transport WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Allocation not found");
}

// --- Transport fees ---

export async function listFees(institutionId: string, routeId?: string) {
  const params: unknown[] = [institutionId];
  let where = "f.institution_id = $1";
  if (routeId) {
    params.push(routeId);
    where += ` AND f.route_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT f.id, f.route_id AS "routeId", r.name AS "routeName",
            f.stop_id AS "stopId", rs.name AS "stopName", f.amount, f.frequency
     FROM transport_fees f
     JOIN transport_routes r ON r.id = f.route_id
     LEFT JOIN route_stops rs ON rs.id = f.stop_id
     WHERE ${where} ORDER BY r.name, rs.name NULLS FIRST`,
    params
  );
  return rows;
}

export async function setFee(
  input: z.infer<typeof setFeeSchema>,
  institutionId: string
) {
  await assertRef("transport_routes", input.routeId, institutionId, "route");
  if (input.stopId) await assertStopOnRoute(input.stopId, input.routeId, institutionId);
  // Upsert: one fee per route (stop NULL) or per stop.
  const conflictTarget = input.stopId
    ? "(institution_id, stop_id) WHERE stop_id IS NOT NULL"
    : "(institution_id, route_id) WHERE stop_id IS NULL";
  const { rows } = await query(
    `INSERT INTO transport_fees (institution_id, route_id, stop_id, amount, frequency)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'monthly'))
     ON CONFLICT ${conflictTarget}
     DO UPDATE SET amount = EXCLUDED.amount, frequency = EXCLUDED.frequency
     RETURNING id, route_id AS "routeId", stop_id AS "stopId", amount, frequency`,
    [institutionId, input.routeId, input.stopId ?? null, input.amount, input.frequency ?? null]
  );
  return rows[0];
}

export async function deleteFee(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM transport_fees WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Fee not found");
}

/**
 * Generates transport-fee invoices for active allocations (optionally one route).
 * Stop-level fee overrides the route-level fee. Idempotent per student+period
 * (existing transport invoices for the period are skipped). Returns counts.
 */
export async function generateInvoices(
  input: z.infer<typeof generateInvoicesSchema>,
  institutionId: string
) {
  return withTransaction(async (client) => {
    const params: unknown[] = [institutionId];
    let where = "st.institution_id = $1 AND st.status = 'active'";
    if (input.routeId) {
      params.push(input.routeId);
      where += ` AND st.route_id = $${params.length}`;
    }
    const { rows: allocations } = await client.query<{
      student_id: string;
      route_id: string;
      stop_id: string | null;
      route_name: string;
    }>(
      `SELECT st.student_id, st.route_id, st.stop_id, r.name AS route_name
       FROM student_transport st
       JOIN transport_routes r ON r.id = st.route_id
       WHERE ${where}`,
      params
    );

    const { rows: fees } = await client.query<{
      route_id: string;
      stop_id: string | null;
      amount: string;
    }>(
      "SELECT route_id, stop_id, amount FROM transport_fees WHERE institution_id = $1",
      [institutionId]
    );
    const routeFee = new Map<string, string>();
    const stopFee = new Map<string, string>();
    for (const f of fees) {
      if (f.stop_id) stopFee.set(f.stop_id, f.amount);
      else routeFee.set(f.route_id, f.amount);
    }

    let generated = 0;
    let skipped = 0;
    for (const a of allocations) {
      const amount = (a.stop_id && stopFee.get(a.stop_id)) || routeFee.get(a.route_id);
      if (amount === undefined) {
        skipped++;
        continue;
      }
      // Skip if an invoice for this student+period already exists.
      const existing = await client.query(
        "SELECT 1 FROM transport_invoices WHERE institution_id = $1 AND student_id = $2 AND period = $3",
        [institutionId, a.student_id, input.period]
      );
      if (existing.rows[0]) {
        skipped++;
        continue;
      }
      const description = input.description ?? `Transport fee — ${a.route_name} (${input.period})`;
      const inv = await client.query<{ id: string }>(
        `INSERT INTO invoices (institution_id, invoice_no, student_id, description, amount_due, due_date)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [institutionId, genInvoiceNo(), a.student_id, description, amount, input.dueDate]
      );
      await client.query(
        `INSERT INTO transport_invoices (institution_id, invoice_id, route_id, student_id, period)
         VALUES ($1, $2, $3, $4, $5)`,
        [institutionId, inv.rows[0].id, a.route_id, a.student_id, input.period]
      );
      generated++;
    }
    return { generated, skipped };
  });
}

// --- Trips (daily log foundation) ---

export async function listTrips(
  institutionId: string,
  filters: { routeId?: string; date?: string }
) {
  const params: unknown[] = [institutionId];
  const where = ["t.institution_id = $1"];
  if (filters.routeId) {
    params.push(filters.routeId);
    where.push(`t.route_id = $${params.length}`);
  }
  if (filters.date) {
    params.push(filters.date);
    where.push(`t.trip_date = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT t.id, t.route_id AS "routeId", r.name AS "routeName",
            t.vehicle_id AS "vehicleId", v.registration_no AS "vehicleNo",
            t.driver_id AS "driverId", d.name AS "driverName",
            t.trip_date AS "tripDate", t.trip_type AS "tripType", t.status
     FROM transport_trips t
     JOIN transport_routes r ON r.id = t.route_id
     LEFT JOIN vehicles v ON v.id = t.vehicle_id
     LEFT JOIN drivers d ON d.id = t.driver_id
     WHERE ${where.join(" AND ")}
     ORDER BY t.trip_date DESC, r.name`,
    params
  );
  return rows;
}

export async function createTrip(
  input: z.infer<typeof createTripSchema>,
  institutionId: string
) {
  await assertRef("transport_routes", input.routeId, institutionId, "route");
  if (input.vehicleId) await assertRef("vehicles", input.vehicleId, institutionId, "vehicle");
  if (input.driverId) await assertRef("drivers", input.driverId, institutionId, "driver");
  try {
    const { rows } = await query(
      `INSERT INTO transport_trips (institution_id, route_id, vehicle_id, driver_id, trip_date, trip_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'scheduled'))
       RETURNING id, route_id AS "routeId", trip_date AS "tripDate", trip_type AS "tripType", status`,
      [
        institutionId,
        input.routeId,
        input.vehicleId ?? null,
        input.driverId ?? null,
        input.tripDate,
        input.tripType,
        input.status ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err))
      throw ApiError.conflict("A trip for that route/date/type already exists");
    throw err;
  }
}

export async function updateTrip(
  id: string,
  input: z.infer<typeof updateTripSchema>,
  institutionId: string
) {
  if (input.vehicleId) await assertRef("vehicles", input.vehicleId, institutionId, "vehicle");
  if (input.driverId) await assertRef("drivers", input.driverId, institutionId, "driver");
  const { sets, params } = buildSets(
    { vehicleId: "vehicle_id", driverId: "driver_id", status: "status" },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  const { rows } = await query(
    `UPDATE transport_trips SET ${sets.join(", ")}
     WHERE id = $${params.length - 1} AND institution_id = $${params.length}
     RETURNING id, route_id AS "routeId", trip_date AS "tripDate", trip_type AS "tripType", status`,
    params
  );
  if (!rows[0]) throw ApiError.notFound("Trip not found");
  return rows[0];
}

// --- Portal (owner-scoped) ---

/** A student's transport allocation with route/stop/vehicle/driver detail. */
export async function studentAllocation(studentId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT st.id, st.trip_type AS "tripType", st.status, st.effective_date AS "effectiveDate",
            r.name AS "routeName", r.code AS "routeCode",
            rs.name AS "stopName", rs.pickup_time AS "pickupTime", rs.drop_time AS "dropTime",
            v.registration_no AS "vehicleNo", d.name AS "driverName", d.phone AS "driverPhone"
     FROM student_transport st
     JOIN transport_routes r ON r.id = st.route_id
     LEFT JOIN route_stops rs ON rs.id = st.stop_id
     LEFT JOIN vehicles v ON v.id = r.vehicle_id
     LEFT JOIN drivers d ON d.id = r.driver_id
     WHERE st.student_id = $1 AND st.institution_id = $2`,
    [studentId, institutionId]
  );
  return rows[0] ?? null;
}
