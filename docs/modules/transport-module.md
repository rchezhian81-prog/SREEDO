# Transport Module

> **Status:** Implemented · **Backend:** `backend/src/modules/transport` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

The Transport module manages the school fleet and student transport: vehicles
(with insurance/fitness/permit expiry tracking), drivers (with licence expiry
and helper details), routes and their ordered stops, per-student route/stop
allocations, route/stop-level fees, transport-fee invoice generation, and a
daily trip log. Transport fees flow into the Fees module's `invoices` table.

Mounted at `/api/v1/transport` (see `backend/src/app.ts`).

## 2. User roles involved

| Role | Typical involvement |
| --- | --- |
| `admin` | Full transport administration (fleet, routes, allocations, fees, trips). |
| `accountant` | Fee mapping and invoice generation (depends on `transport:fees`). |
| `teacher` | Read-only/operational involvement where granted. |
| `student` / `parent` | View the student's own route/stop/vehicle/driver details via the portal route. |
| `super_admin` | Cross-tenant; bypasses permission checks. |

## 3. Main screens / pages

Frontend route group: `frontend/src/app/(dashboard)/transport/`

- `transport/page.tsx` — overview
- `transport/vehicles/` — fleet register
- `transport/drivers/` — drivers & helpers
- `transport/routes/` — routes and stops
- `transport/allocations/` — student allocations
- `transport/fees/` — fee mapping & invoice generation
- `transport/reports/` — transport reporting

## 4. Main backend APIs

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/transport/vehicles` | List vehicles (+ expiry, route counts) | `transport:read` |
| POST | `/transport/vehicles` | Create a vehicle | `transport:create` |
| PATCH | `/transport/vehicles/:id` | Update a vehicle | `transport:update` |
| DELETE | `/transport/vehicles/:id` | Delete a vehicle | `transport:delete` |
| GET | `/transport/drivers` | List drivers | `transport:read` |
| POST | `/transport/drivers` | Create a driver | `transport:create` |
| PATCH | `/transport/drivers/:id` | Update a driver | `transport:update` |
| DELETE | `/transport/drivers/:id` | Delete a driver | `transport:delete` |
| GET | `/transport/routes` | List routes (+ vehicle/driver, counts) | `transport:read` |
| POST | `/transport/routes` | Create a route | `transport:create` |
| PATCH | `/transport/routes/:id` | Update a route | `transport:update` |
| DELETE | `/transport/routes/:id` | Delete a route (cascades) | `transport:delete` |
| GET | `/transport/routes/:routeId/stops` | List a route's stops | `transport:read` |
| POST | `/transport/routes/:routeId/stops` | Add a stop | `transport:create` |
| PATCH | `/transport/stops/:id` | Update a stop | `transport:update` |
| DELETE | `/transport/stops/:id` | Delete a stop | `transport:delete` |
| GET | `/transport/allocations` | List allocations (filter route/stop) | `transport:read` |
| POST | `/transport/allocations` | Allocate a student to a route/stop | `transport:allocate` |
| PATCH | `/transport/allocations/:id` | Update an allocation | `transport:allocate` |
| DELETE | `/transport/allocations/:id` | Remove an allocation | `transport:allocate` |
| GET | `/transport/fees` | List transport fees | `transport:read` |
| POST | `/transport/fees` | Set a route/stop fee (upsert) | `transport:fees` |
| DELETE | `/transport/fees/:id` | Delete a fee mapping | `transport:fees` |
| POST | `/transport/fees/generate` | Generate fee invoices (idempotent) | `transport:fees` |
| GET | `/transport/trips` | List trips (filter route/date) | `transport:read` |
| POST | `/transport/trips` | Schedule a trip | `transport:update` |
| PATCH | `/transport/trips/:id` | Update a trip (status/vehicle/driver) | `transport:update` |
| GET | `/transport/students/:studentId/allocation` | Student's own details (portal) | Owner-scoped (no permission key) |

Note: trip create/update use `transport:update` (not a separate "trips" key).
All staff routes require JWT Bearer + tenant context.

## 5. Database tables / entities

- `vehicles` — `registration_no` (unique per tenant), `type`, `capacity`,
  `insurance_expiry`, `fitness_expiry`, `permit_expiry`, `is_active`.
- `drivers` — `name`, `phone`, `license_number`, `license_expiry`,
  `helper_name`, `helper_phone`, `is_active`.
- `transport_routes` — `name`, `code` (unique per tenant), optional
  `vehicle_id` / `driver_id`, `is_active`.
- `route_stops` — `route_id`, `name` (unique per route), `stop_order`,
  `pickup_time`, `drop_time`, `distance_km`, `zone`.
- `student_transport` — student allocations (`student_id`, `route_id`,
  `stop_id`, `trip_type` ∈ `pickup | drop | both`, `effective_date`, `status` ∈
  `active | inactive`); a student has one allocation (unique constraint).
- `transport_fees` — `route_id`, optional `stop_id`, `amount`, `frequency` ∈
  `monthly | term | annual`; upsert per route (stop NULL) or per stop.
- `transport_invoices` — links a generated `invoices` row to `route_id`,
  `student_id`, `period`; used for idempotency (one per student+period).
- `transport_trips` — daily log: `route_id`, `vehicle_id`, `driver_id`,
  `trip_date`, `trip_type` ∈ `pickup | drop`, `status` ∈
  `scheduled | completed | cancelled`; unique per route/date/type.

Generated invoices live in the Fees module's `invoices` table (`invoice_no`
prefixed `TRP-`).

## 6. Permissions / RBAC involved

- `transport:read` — view all listings
- `transport:create` — create vehicles, drivers, routes, stops
- `transport:update` — update vehicles/drivers/routes/stops; create/update trips
- `transport:delete` — delete vehicles/drivers/routes/stops
- `transport:allocate` — create/update/delete student allocations
- `transport:fees` — set/delete fees and generate invoices

`super_admin` bypasses checks; the portal allocation route is owner-scoped.

## 7. Tenant isolation notes

All tables carry `institution_id`; `requireTenant` is applied router-wide and
every query filters by it. `assertRef` validates that referenced vehicles,
drivers, routes, stops, and students belong to the same tenant, and
`assertStopOnRoute` confirms a stop belongs to its route. Integration test "is
tenant-scoped (no cross-institution access)" covers this.

## 8. Key workflows

1. **Fleet & route setup** — register vehicles and drivers, create routes
   (optionally assigning a vehicle + driver), then add ordered stops.
2. **Allocation** — `POST /transport/allocations` ties a student to a route and
   optional stop with a `trip_type`. One active allocation per student.
3. **Fee mapping** — set fees at route level (stop NULL) or stop level; a
   stop-level fee overrides the route-level fee.
4. **Invoice generation** — `POST /transport/fees/generate` with `period` and
   `dueDate` (optionally one route). For each active allocation it resolves the
   applicable fee, **skips** students who already have a transport invoice for
   the period (idempotent), and creates an `invoices` + `transport_invoices`
   row. Returns `{ generated, skipped }`.
5. **Trips** — schedule one pickup and one drop per route/day; update status as
   trips complete or cancel.

See [MODULE_WORKFLOWS.md](../MODULE_WORKFLOWS.md).

## 9. Test coverage summary

Integration tests in `backend/tests/integration/transport.int.test.ts` (7 cases,
need `DATABASE_URL`; `npm run test:integration`): fleet/route/stop management;
student allocation + owner-scoped portal details; fee mapping with stop-over-
route precedence and idempotent invoice generation; transport reports; trip
scheduling with the one-per-route/date/type constraint; permission guards; and
tenant scoping. No dedicated unit tests.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| "A route with that code exists" (409) | Duplicate route `code` in the tenant | Use a unique code |
| "Stop does not belong to the route" | `stopId` not under the target route | Choose a stop on that route, or move the stop |
| "That student already has a transport allocation" (409) | One-allocation-per-student constraint | Update the existing allocation instead |
| `generate` returns high `skipped` | No fee mapped, or invoice already exists for the period | Map a route/stop fee; idempotency skips duplicates |
| "A trip for that route/date/type already exists" | Duplicate trip | Update the existing trip |
| Vehicle/driver expiry not surfacing | Expiry dates left null | Set `insuranceExpiry` / `fitnessExpiry` / `permitExpiry` / `licenseExpiry` |

## 11. Future enhancement notes

- GPS/live tracking and ETA on the trip log.
- Per-student attendance on trips (boarding scans).
- Capacity enforcement against vehicle `capacity` when allocating.
- Automated fee-invoice scheduling via background jobs (mirrors hostel/fees).
- Parent notifications on trip start/arrival (reuse Communication channels).
