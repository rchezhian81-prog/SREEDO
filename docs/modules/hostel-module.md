# Hostel Module

> **Status:** Implemented · **Backend:** `backend/src/modules/hostel` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

The Hostel module manages boarding facilities: hostels (boys/girls/co-ed/staff)
with optional blocks and rooms, bed-level student allocations with capacity
enforcement, transfer and vacate operations, hostel/room-type fees, and
hostel-fee invoice generation that flows into the Fees module's `invoices`
table.

Mounted at `/api/v1/hostel` (see `backend/src/app.ts`).

## 2. User roles involved

| Role | Typical involvement |
| --- | --- |
| `admin` | Full hostel administration (facilities, allocations, fees). |
| `accountant` | Fee mapping and invoice generation (`hostel:fees`). |
| Warden-style staff | Allocations/transfers/vacates (depends on `hostel:allocate`). |
| `student` / `parent` | View the student's own active allocation via the portal route. |
| `super_admin` | Cross-tenant; bypasses permission checks. |

## 3. Main screens / pages

Frontend route group: `frontend/src/app/(dashboard)/hostel/`

- `hostel/page.tsx` — overview (occupancy)
- `hostel/hostels/` — hostels, blocks, rooms
- `hostel/allocations/` — student allocations (allocate/transfer/vacate)
- `hostel/fees/` — fee mapping & invoice generation
- `hostel/reports/` — occupancy & room reports

## 4. Main backend APIs

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/hostel/hostels` | List hostels (+ room/bed counts, occupancy) | `hostel:read` |
| POST | `/hostel/hostels` | Create a hostel | `hostel:create` |
| PATCH | `/hostel/hostels/:id` | Update a hostel | `hostel:update` |
| DELETE | `/hostel/hostels/:id` | Delete a hostel (cascades) | `hostel:delete` |
| GET | `/hostel/hostels/:hostelId/blocks` | List a hostel's blocks | `hostel:read` |
| POST | `/hostel/hostels/:hostelId/blocks` | Add a block | `hostel:create` |
| PATCH | `/hostel/blocks/:id` | Update a block | `hostel:update` |
| DELETE | `/hostel/blocks/:id` | Delete a block | `hostel:delete` |
| GET | `/hostel/hostels/:hostelId/rooms` | List rooms (+ occupied/available beds) | `hostel:read` |
| POST | `/hostel/hostels/:hostelId/rooms` | Add a room | `hostel:create` |
| PATCH | `/hostel/rooms/:id` | Update a room | `hostel:update` |
| DELETE | `/hostel/rooms/:id` | Delete a room (blocked if occupied) | `hostel:delete` |
| GET | `/hostel/allocations` | List allocations (filter hostel/room/status) | `hostel:read` |
| POST | `/hostel/allocations` | Allocate a student to a room/bed | `hostel:allocate` |
| POST | `/hostel/allocations/:id/transfer` | Transfer to another room | `hostel:allocate` |
| POST | `/hostel/allocations/:id/vacate` | Vacate an active allocation | `hostel:allocate` |
| DELETE | `/hostel/allocations/:id` | Delete an allocation record | `hostel:delete` |
| GET | `/hostel/fees` | List hostel fees | `hostel:read` |
| POST | `/hostel/fees` | Set a hostel/room-type fee (upsert) | `hostel:fees` |
| DELETE | `/hostel/fees/:id` | Delete a fee mapping | `hostel:fees` |
| POST | `/hostel/fees/generate` | Generate fee invoices (idempotent) | `hostel:fees` |
| GET | `/hostel/students/:studentId/allocation` | Student's own allocation (portal) | Owner-scoped (no permission key) |

All staff routes require JWT Bearer + tenant context.

## 5. Database tables / entities

- `hostels` — `name`, `code` (unique per tenant), `type` ∈
  `boys | girls | co_ed | staff` (default `boys`), `address`, `warden_name`,
  `warden_phone`, `contact_phone`, `capacity`, `is_active`.
- `hostel_blocks` — `hostel_id`, `name` (unique per hostel).
- `hostel_rooms` — `hostel_id`, optional `block_id`, `room_number` (unique per
  hostel), `floor`, `room_type`, `capacity` (default 1), `status` ∈
  `available | occupied | maintenance | inactive`.
- `hostel_allocations` — `student_id`, `hostel_id`, `room_id`, `bed_no`,
  `allocation_date`, `vacate_date`, `status` ∈ `active | vacated | transferred`.
  Unique constraints enforce one active allocation per student and one per bed.
- `hostel_fees` — `hostel_id`, optional `room_type`, `amount`, `frequency` ∈
  `monthly | term | annual`; upsert per hostel (room_type NULL) or per room type.
- `hostel_invoices` — links a generated `invoices` row to `hostel_id`,
  `student_id`, `period`; used for idempotency.

Generated invoices live in the Fees module's `invoices` table (`invoice_no`
prefixed `HST-`).

## 6. Permissions / RBAC involved

- `hostel:read` — view all listings
- `hostel:create` — create hostels, blocks, rooms
- `hostel:update` — update hostels, blocks, rooms
- `hostel:delete` — delete hostels/blocks/rooms and allocation records
- `hostel:allocate` — allocate, transfer, vacate
- `hostel:fees` — set/delete fees and generate invoices

`super_admin` bypasses checks; the portal allocation route is owner-scoped.

## 7. Tenant isolation notes

All tables carry `institution_id`; `requireTenant` is router-wide and every
query filters by it. `assertRef` validates hostels, blocks, rooms, and students
against the tenant, and `reserveRoom` confirms a room belongs to its hostel
before allocating. Integration test "is tenant-scoped (no cross-institution
access)" covers this.

## 8. Key workflows

1. **Facility setup** — create a hostel, optional blocks, then rooms with a
   `capacity`.
2. **Allocation** — `POST /hostel/allocations`. `reserveRoom` locks the room
   (`FOR UPDATE`), rejects rooms in `maintenance`/`inactive`, and rejects when
   active occupants ≥ `capacity` ("Room is full"). Unique constraints surface as
   "That bed is already occupied" / "That student already has an active
   allocation".
3. **Transfer** — `POST /hostel/allocations/:id/transfer` closes the current
   allocation (`status → transferred`, sets `vacate_date`) so its bed frees,
   then opens a new allocation in the target room within one transaction.
4. **Vacate** — `POST /hostel/allocations/:id/vacate` sets `status → vacated`
   and `vacate_date`.
5. **Fee mapping & generation** — set fees at hostel level (room_type NULL) or
   room-type level; the room-type fee overrides the hostel fee. `POST
   /hostel/fees/generate` creates invoices for active allocations, idempotent
   per student+period, returning `{ generated, skipped }`.

See [MODULE_WORKFLOWS.md](../MODULE_WORKFLOWS.md).

## 9. Test coverage summary

Integration tests in `backend/tests/integration/hostel.int.test.ts` (7 cases,
need `DATABASE_URL`; `npm run test:integration`): facility management
(hostels/blocks/rooms); allocation with capacity enforcement and owner-scoped
portal details; transfer/vacate; fee mapping with room-type-over-hostel
precedence and idempotent invoice generation; occupancy and room reports;
permission guards; and tenant scoping. No dedicated unit tests.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| "Room is full" (409) | Active occupants ≥ room `capacity` | Use another room, raise capacity, or vacate someone |
| "Room is maintenance" / "Room is inactive" | Room `status` blocks allocation | Set the room to `available` first |
| "That bed is already occupied" | Duplicate `bed_no` in the room | Choose a free bed number |
| "That student already has an active allocation" | One-active-allocation constraint | Transfer or vacate the existing allocation |
| "Cannot delete a room with active occupants" | Active allocations on the room | Vacate/transfer occupants first |
| `generate` skips students | No fee mapped, or invoice already exists for the period | Map a hostel/room-type fee; idempotency skips duplicates |

## 11. Future enhancement notes

- Mess/meal-plan management and billing.
- Visitor and gate-pass / in-out register.
- Waitlist and room-preference handling.
- Scheduled hostel-fee invoice runs via background jobs.
- Maintenance-request workflow tied to room `status`.
