# Inventory Module

> **Status:** Implemented · **Backend:** `backend/src/modules/inventory` · **Last updated:** 2026-06-23 · **Owner:** Engineering
>
> Related: [Docs index](../README.md) · [Diagrams](../diagrams/) · [Module workflows](../MODULE_WORKFLOWS.md) · [DB schema](../DATABASE_SCHEMA.md) · [Roles & permissions](../ROLES_AND_PERMISSIONS.md)

## 1. Purpose

The Inventory module is a stock-control system for school stores: item
categories, vendors, items with opening/current stock and a low-stock
threshold, purchases (stock in), issues (stock out), and signed adjustments
(damage/lost/correction). Every quantity change is recorded as a movement in an
append-only `stock_movements` ledger that records the resulting balance, giving
a full audit trail per item. Purchases can attach a supporting `documents`
record.

Mounted at `/api/v1/inventory` (see `backend/src/app.ts`).

## 2. User roles involved

| Role | Typical involvement |
| --- | --- |
| `admin` | Full inventory administration. |
| Store/clerk staff | Record purchases, issues and adjustments (depends on `inventory:*` keys). |
| `accountant` | Purchase recording / vendor management where granted. |
| `super_admin` | Cross-tenant; bypasses permission checks. |

No student/parent-facing or owner-scoped routes — this module is staff-only.

## 3. Main screens / pages

Frontend route group: `frontend/src/app/(dashboard)/inventory/`

- `inventory/page.tsx` — overview (low-stock)
- `inventory/categories/` — item categories
- `inventory/vendors/` — vendors
- `inventory/items/` — items + movement history
- `inventory/purchase/` — record purchases (stock in)
- `inventory/issue/` — issue stock (stock out)
- `inventory/adjustments/` — stock adjustments
- `inventory/reports/` — inventory reporting

## 4. Main backend APIs

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/inventory/categories` | List categories (+ item counts) | `inventory:read` |
| POST | `/inventory/categories` | Create a category | `inventory:create` |
| PATCH | `/inventory/categories/:id` | Update a category | `inventory:update` |
| DELETE | `/inventory/categories/:id` | Delete a category | `inventory:delete` |
| GET | `/inventory/vendors` | List vendors | `inventory:read` |
| POST | `/inventory/vendors` | Create a vendor | `inventory:create` |
| PATCH | `/inventory/vendors/:id` | Update a vendor | `inventory:update` |
| DELETE | `/inventory/vendors/:id` | Delete a vendor | `inventory:delete` |
| GET | `/inventory/items` | List items (current stock, low-stock flag) | `inventory:read` |
| POST | `/inventory/items` | Create an item (opening stock seeds current) | `inventory:create` |
| PATCH | `/inventory/items/:id` | Update an item (opening stock immutable) | `inventory:update` |
| DELETE | `/inventory/items/:id` | Delete an item (blocked if it has history) | `inventory:delete` |
| GET | `/inventory/items/:id/movements` | Item movement ledger | `inventory:read` |
| GET | `/inventory/purchases` | List purchases (filter vendor) | `inventory:read` |
| POST | `/inventory/purchases` | Record a purchase (stock in) | `inventory:purchase` |
| GET | `/inventory/purchases/:id` | Get a purchase with line items | `inventory:read` |
| GET | `/inventory/issues` | List issues (filter item) | `inventory:read` |
| POST | `/inventory/issues` | Issue stock (stock out) | `inventory:issue` |
| GET | `/inventory/adjustments` | List adjustments (filter item) | `inventory:read` |
| POST | `/inventory/adjustments` | Adjust stock (signed delta) | `inventory:adjust` |

All routes require JWT Bearer + tenant context.

## 5. Database tables / entities

- `item_categories` — `name` (unique per tenant), `code`.
- `vendors` — `name` (unique per tenant), `contact_person`, `phone`, `email`,
  `gst_number`, `address`, `payment_terms`, `is_active`.
- `inventory_items` — `name`, `code` (unique per tenant), `unit`, `category_id`,
  `opening_stock`, `current_stock`, `min_stock_level`, `location`, `is_active`.
- `purchases` — `vendor_id`, `purchase_date`, `bill_no`, `total_amount`,
  `document_id` (attachment), `notes`, `created_by`.
- `purchase_items` — `purchase_id`, `item_id`, `quantity`, `rate`, `amount`.
- `stock_movements` — append-only ledger: `item_id`, `type` ∈
  `opening | purchase | issue | adjustment`, `change` (signed), `balance_after`,
  `ref_table`, `ref_id`, `note`.
- `stock_issues` — `item_id`, `quantity`, `issued_to_type` ∈
  `department | staff | student | event | other`, `issued_to`, `purpose`,
  `issue_date`, `received_by`, `issued_by`.
- `stock_adjustments` — `item_id`, `quantity` (signed), `reason` ∈
  `damage | lost | correction`, `note`, `approved_by`, `created_by`.

## 6. Permissions / RBAC involved

- `inventory:read` — view all listings and movement history
- `inventory:create` — create categories, vendors, items
- `inventory:update` — update categories, vendors, items
- `inventory:delete` — delete categories, vendors, items
- `inventory:purchase` — record purchases
- `inventory:issue` — issue stock
- `inventory:adjust` — adjust stock

`super_admin` bypasses all checks.

## 7. Tenant isolation notes

All tables carry `institution_id`; `requireTenant` is router-wide and every
query filters by it. `assertRef` validates categories, vendors, items and
attached documents against the tenant. The core `applyMovement` helper locks the
item row (`FOR UPDATE`) scoped to `institution_id` before updating stock and
appending the ledger row. Integration test "is tenant-scoped (no
cross-institution access)" covers this.

## 8. Key workflows

1. **Setup** — create categories and vendors, then items. An item's
   `openingStock` seeds `current_stock` and writes an `opening` movement.
   Opening stock is immutable afterwards (use an adjustment).
2. **Purchase (stock in)** — `POST /inventory/purchases` with line items.
   Computes line `amount` and `total_amount`, inserts `purchases` +
   `purchase_items`, and calls `applyMovement(type=purchase, +qty)` per line,
   all in one transaction.
3. **Issue (stock out)** — `POST /inventory/issues`. Decrements first via
   `applyMovement(type=issue, -qty)`, which rejects with "Insufficient stock"
   if the balance would go negative, then records the `stock_issues` row.
4. **Adjustment** — `POST /inventory/adjustments` with a signed `quantity`
   (negative reduces). Same negative-balance guard applies.
5. **Audit** — `GET /inventory/items/:id/movements` returns the chronological
   ledger with running `balanceAfter`.

See [MODULE_WORKFLOWS.md](../MODULE_WORKFLOWS.md).

## 9. Test coverage summary

Integration tests in `backend/tests/integration/inventory.int.test.ts` (8 cases,
need `DATABASE_URL`; `npm run test:integration`): category/vendor/item
management with opening stock seeding current; stock increase on purchase; stock
decrease on issue with over-issue prevention; signed adjustments with the
negative guard; low-stock / movement / vendor-purchase reporting; blocking
deletion of an item that has movement history; permission guards; and tenant
scoping. No dedicated unit tests.

## 10. Common troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| "Insufficient stock" (409) on issue/adjust | Resulting balance would be negative | Reduce the quantity or restock via a purchase |
| "An item with that code exists" (409) | Duplicate item `code` in the tenant | Use a unique code |
| "Cannot delete an item with stock movement history" | Ledger rows exist for the item | Deactivate (`isActive=false`) instead of deleting |
| Opening stock won't update via PATCH | Opening stock is immutable | Post an adjustment to correct the balance |
| Item not flagged low-stock | `min_stock_level` is 0/unset | Set a meaningful `minStockLevel` |
| Purchase total looks off | `rate` omitted defaults to 0 | Provide `rate` on each line |

## 11. Future enhancement notes

- Purchase-order and goods-received workflow (approval before stock in).
- Asset register / serialized tracking for durable items.
- Reorder alerts on low stock (reuse Communication channels / jobs).
- Multi-location/store transfers.
- Linking issues to requesting departments or staff records by id.
