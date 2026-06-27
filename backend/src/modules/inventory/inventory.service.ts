import type { PoolClient } from "pg";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { toPaise, toRupees } from "../../utils/money";
import type { z } from "zod";
import type {
  createAdjustmentSchema,
  createCategorySchema,
  createIssueSchema,
  createItemSchema,
  createPurchaseSchema,
  createVendorSchema,
  updateCategorySchema,
  updateItemSchema,
  updateVendorSchema,
} from "./inventory.schema";

function isUnique(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
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
  table: "item_categories" | "vendors" | "inventory_items" | "documents",
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

/**
 * Applies a signed stock change to an item inside a transaction: locks the item
 * row, updates current_stock (rejecting a negative balance), and appends a
 * stock_movements ledger row with the resulting balance. Returns the balance.
 */
async function applyMovement(
  client: PoolClient,
  p: {
    institutionId: string;
    itemId: string;
    type: "opening" | "purchase" | "issue" | "adjustment";
    change: number;
    refTable?: string;
    refId?: string;
    note?: string | null;
  }
): Promise<number> {
  const r = await client.query<{ current_stock: string }>(
    "SELECT current_stock FROM inventory_items WHERE id = $1 AND institution_id = $2 FOR UPDATE",
    [p.itemId, p.institutionId]
  );
  if (!r.rows[0]) throw ApiError.badRequest("Invalid item");
  const balance = Number(r.rows[0].current_stock) + p.change;
  if (balance < 0) throw ApiError.conflict("Insufficient stock");
  await client.query("UPDATE inventory_items SET current_stock = $1 WHERE id = $2", [
    balance,
    p.itemId,
  ]);
  await client.query(
    `INSERT INTO stock_movements (institution_id, item_id, type, change, balance_after, ref_table, ref_id, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [p.institutionId, p.itemId, p.type, p.change, balance, p.refTable ?? null, p.refId ?? null, p.note ?? null]
  );
  return balance;
}

// --- Categories ---

export async function listCategories(institutionId: string) {
  const { rows } = await query(
    `SELECT c.id, c.name, c.code,
            (SELECT count(*)::int FROM inventory_items i WHERE i.category_id = c.id) AS "itemCount"
     FROM item_categories c WHERE c.institution_id = $1 ORDER BY c.name`,
    [institutionId]
  );
  return rows;
}

export async function createCategory(
  input: z.infer<typeof createCategorySchema>,
  institutionId: string
) {
  try {
    const { rows } = await query(
      `INSERT INTO item_categories (institution_id, name, code) VALUES ($1, $2, $3)
       RETURNING id, name, code`,
      [institutionId, input.name, input.code ?? null]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A category with that name exists");
    throw err;
  }
}

export async function updateCategory(
  id: string,
  input: z.infer<typeof updateCategorySchema>,
  institutionId: string
) {
  const { sets, params } = buildSets({ name: "name", code: "code" }, input as Record<string, unknown>);
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE item_categories SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, name, code`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Category not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A category with that name exists");
    throw err;
  }
}

export async function deleteCategory(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM item_categories WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Category not found");
}

// --- Vendors ---

const VENDOR_COLS = `id, name, contact_person AS "contactPerson", phone, email,
  gst_number AS "gstNumber", address, payment_terms AS "paymentTerms", is_active AS "isActive"`;

export async function listVendors(institutionId: string) {
  const { rows } = await query(
    `SELECT ${VENDOR_COLS} FROM vendors WHERE institution_id = $1 ORDER BY name`,
    [institutionId]
  );
  return rows;
}

export async function createVendor(
  input: z.infer<typeof createVendorSchema>,
  institutionId: string
) {
  try {
    const { rows } = await query(
      `INSERT INTO vendors (institution_id, name, contact_person, phone, email, gst_number, address, payment_terms, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, true))
       RETURNING ${VENDOR_COLS}`,
      [
        institutionId,
        input.name,
        input.contactPerson ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.gstNumber ?? null,
        input.address ?? null,
        input.paymentTerms ?? null,
        input.isActive ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A vendor with that name exists");
    throw err;
  }
}

export async function updateVendor(
  id: string,
  input: z.infer<typeof updateVendorSchema>,
  institutionId: string
) {
  const { sets, params } = buildSets(
    {
      name: "name",
      contactPerson: "contact_person",
      phone: "phone",
      email: "email",
      gstNumber: "gst_number",
      address: "address",
      paymentTerms: "payment_terms",
      isActive: "is_active",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE vendors SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING ${VENDOR_COLS}`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Vendor not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("A vendor with that name exists");
    throw err;
  }
}

export async function deleteVendor(id: string, institutionId: string) {
  const { rowCount } = await query(
    "DELETE FROM vendors WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Vendor not found");
}

// --- Items ---

export async function listItems(
  institutionId: string,
  filters: { categoryId?: string; search?: string; lowStock?: boolean }
) {
  const params: unknown[] = [institutionId];
  const where = ["i.institution_id = $1"];
  if (filters.categoryId) {
    params.push(filters.categoryId);
    where.push(`i.category_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(i.name ILIKE $${params.length} OR i.code ILIKE $${params.length})`);
  }
  if (filters.lowStock) where.push("i.current_stock <= i.min_stock_level");
  const { rows } = await query(
    `SELECT i.id, i.name, i.code, i.unit, i.category_id AS "categoryId", c.name AS "categoryName",
            i.opening_stock AS "openingStock", i.current_stock AS "currentStock",
            i.min_stock_level AS "minStockLevel", i.location, i.is_active AS "isActive",
            (i.current_stock <= i.min_stock_level) AS "lowStock"
     FROM inventory_items i
     LEFT JOIN item_categories c ON c.id = i.category_id
     WHERE ${where.join(" AND ")}
     ORDER BY i.name`,
    params
  );
  return rows;
}

export async function createItem(
  input: z.infer<typeof createItemSchema>,
  institutionId: string
) {
  if (input.categoryId)
    await assertRef("item_categories", input.categoryId, institutionId, "category");
  const opening = input.openingStock ?? 0;
  return withTransaction(async (client) => {
    let rows;
    try {
      ({ rows } = await client.query(
        `INSERT INTO inventory_items (institution_id, category_id, name, code, unit, opening_stock, current_stock, min_stock_level, location, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $6, COALESCE($7, 0), $8, COALESCE($9, true))
         RETURNING id, name, code, current_stock AS "currentStock", min_stock_level AS "minStockLevel"`,
        [
          institutionId,
          input.categoryId ?? null,
          input.name,
          input.code,
          input.unit ?? null,
          opening,
          input.minStockLevel ?? null,
          input.location ?? null,
          input.isActive ?? null,
        ]
      ));
    } catch (err) {
      if (isUnique(err)) throw ApiError.conflict("An item with that code exists");
      throw err;
    }
    const item = rows[0] as { id: string };
    if (opening !== 0) {
      await client.query(
        `INSERT INTO stock_movements (institution_id, item_id, type, change, balance_after, note)
         VALUES ($1, $2, 'opening', $3, $3, 'Opening stock')`,
        [institutionId, item.id, opening]
      );
    }
    return rows[0];
  });
}

export async function updateItem(
  id: string,
  input: z.infer<typeof updateItemSchema>,
  institutionId: string
) {
  if (input.categoryId)
    await assertRef("item_categories", input.categoryId, institutionId, "category");
  const { sets, params } = buildSets(
    {
      name: "name",
      code: "code",
      categoryId: "category_id",
      unit: "unit",
      minStockLevel: "min_stock_level",
      location: "location",
      isActive: "is_active",
    },
    input as Record<string, unknown>
  );
  params.push(id, institutionId);
  try {
    const { rows } = await query(
      `UPDATE inventory_items SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND institution_id = $${params.length}
       RETURNING id, name, code, current_stock AS "currentStock", min_stock_level AS "minStockLevel"`,
      params
    );
    if (!rows[0]) throw ApiError.notFound("Item not found");
    return rows[0];
  } catch (err) {
    if (isUnique(err)) throw ApiError.conflict("An item with that code exists");
    throw err;
  }
}

export async function deleteItem(id: string, institutionId: string) {
  const moved = await query(
    "SELECT 1 FROM stock_movements WHERE item_id = $1 AND institution_id = $2 LIMIT 1",
    [id, institutionId]
  );
  if (moved.rows[0])
    throw ApiError.conflict("Cannot delete an item with stock movement history");
  const { rowCount } = await query(
    "DELETE FROM inventory_items WHERE id = $1 AND institution_id = $2",
    [id, institutionId]
  );
  if (!rowCount) throw ApiError.notFound("Item not found");
}

// --- Purchases (stock in) ---

export async function listPurchases(institutionId: string, vendorId?: string) {
  const params: unknown[] = [institutionId];
  let where = "p.institution_id = $1";
  if (vendorId) {
    params.push(vendorId);
    where += ` AND p.vendor_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT p.id, p.vendor_id AS "vendorId", v.name AS "vendorName",
            p.purchase_date AS "purchaseDate", p.bill_no AS "billNo",
            p.total_amount AS "totalAmount", p.document_id AS "documentId", p.notes,
            (SELECT count(*)::int FROM purchase_items pi WHERE pi.purchase_id = p.id) AS "lineCount"
     FROM purchases p LEFT JOIN vendors v ON v.id = p.vendor_id
     WHERE ${where} ORDER BY p.purchase_date DESC, p.created_at DESC`,
    params
  );
  return rows;
}

export async function getPurchase(id: string, institutionId: string) {
  const { rows } = await query(
    `SELECT p.id, p.vendor_id AS "vendorId", v.name AS "vendorName",
            p.purchase_date AS "purchaseDate", p.bill_no AS "billNo",
            p.total_amount AS "totalAmount", p.document_id AS "documentId", p.notes
     FROM purchases p LEFT JOIN vendors v ON v.id = p.vendor_id
     WHERE p.id = $1 AND p.institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw ApiError.notFound("Purchase not found");
  const items = await query(
    `SELECT pi.id, pi.item_id AS "itemId", it.name AS "itemName", it.unit,
            pi.quantity, pi.rate, pi.amount
     FROM purchase_items pi JOIN inventory_items it ON it.id = pi.item_id
     WHERE pi.purchase_id = $1 AND pi.institution_id = $2 ORDER BY pi.created_at`,
    [id, institutionId]
  );
  return { ...rows[0], items: items.rows };
}

export async function createPurchase(
  input: z.infer<typeof createPurchaseSchema>,
  createdBy: string,
  institutionId: string
) {
  if (input.vendorId) await assertRef("vendors", input.vendorId, institutionId, "vendor");
  if (input.documentId) await assertRef("documents", input.documentId, institutionId, "document");
  for (const line of input.items)
    await assertRef("inventory_items", line.itemId, institutionId, "item");

  const lines = input.items.map((l) => {
    const rate = l.rate ?? 0;
    // rate is money, quantity a (possibly fractional) count: amount = rate × qty.
    const amountPaise = Math.round(toPaise(rate) * l.quantity);
    return { ...l, rate, amountPaise, amount: toRupees(amountPaise) };
  });
  const total = toRupees(lines.reduce((s, l) => s + l.amountPaise, 0));

  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO purchases (institution_id, vendor_id, purchase_date, bill_no, total_amount, document_id, notes, created_by)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8) RETURNING id`,
      [
        institutionId,
        input.vendorId ?? null,
        input.purchaseDate ?? null,
        input.billNo ?? null,
        total,
        input.documentId ?? null,
        input.notes ?? null,
        createdBy,
      ]
    );
    const purchaseId = rows[0].id;
    for (const l of lines) {
      const pi = await client.query<{ id: string }>(
        `INSERT INTO purchase_items (institution_id, purchase_id, item_id, quantity, rate, amount)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [institutionId, purchaseId, l.itemId, l.quantity, l.rate, l.amount]
      );
      await applyMovement(client, {
        institutionId,
        itemId: l.itemId,
        type: "purchase",
        change: l.quantity,
        refTable: "purchase_items",
        refId: pi.rows[0].id,
      });
    }
    return { id: purchaseId, totalAmount: total, lineCount: lines.length };
  });
}

// --- Stock issue (stock out) ---

export async function listIssues(institutionId: string, itemId?: string) {
  const params: unknown[] = [institutionId];
  let where = "si.institution_id = $1";
  if (itemId) {
    params.push(itemId);
    where += ` AND si.item_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT si.id, si.item_id AS "itemId", it.name AS "itemName", it.unit,
            si.quantity, si.issued_to_type AS "issuedToType", si.issued_to AS "issuedTo",
            si.purpose, si.issue_date AS "issueDate", si.received_by AS "receivedBy"
     FROM stock_issues si JOIN inventory_items it ON it.id = si.item_id
     WHERE ${where} ORDER BY si.issue_date DESC, si.created_at DESC`,
    params
  );
  return rows;
}

export async function createIssue(
  input: z.infer<typeof createIssueSchema>,
  issuedBy: string,
  institutionId: string
) {
  return withTransaction(async (client) => {
    // Decrement first so applyMovement enforces sufficiency atomically.
    await applyMovement(client, {
      institutionId,
      itemId: input.itemId,
      type: "issue",
      change: -input.quantity,
      refTable: "stock_issues",
      refId: undefined,
      note: input.purpose ?? null,
    });
    const { rows } = await client.query(
      `INSERT INTO stock_issues (institution_id, item_id, quantity, issued_to_type, issued_to, purpose, issue_date, received_by, issued_by)
       VALUES ($1, $2, $3, COALESCE($4, 'department'), $5, $6, COALESCE($7::date, CURRENT_DATE), $8, $9)
       RETURNING id, item_id AS "itemId", quantity, issued_to_type AS "issuedToType", issue_date AS "issueDate"`,
      [
        institutionId,
        input.itemId,
        input.quantity,
        input.issuedToType ?? null,
        input.issuedTo ?? null,
        input.purpose ?? null,
        input.issueDate ?? null,
        input.receivedBy ?? null,
        issuedBy,
      ]
    );
    // Backfill the movement's ref to the created issue row.
    await client.query(
      `UPDATE stock_movements SET ref_id = $1
       WHERE id = (SELECT id FROM stock_movements
                   WHERE institution_id = $2 AND item_id = $3 AND ref_table = 'stock_issues' AND ref_id IS NULL
                   ORDER BY created_at DESC LIMIT 1)`,
      [rows[0].id, institutionId, input.itemId]
    );
    return rows[0];
  });
}

// --- Stock adjustment ---

export async function listAdjustments(institutionId: string, itemId?: string) {
  const params: unknown[] = [institutionId];
  let where = "sa.institution_id = $1";
  if (itemId) {
    params.push(itemId);
    where += ` AND sa.item_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT sa.id, sa.item_id AS "itemId", it.name AS "itemName",
            sa.quantity, sa.reason, sa.note, sa.approved_by AS "approvedBy", sa.created_at AS "createdAt"
     FROM stock_adjustments sa JOIN inventory_items it ON it.id = sa.item_id
     WHERE ${where} ORDER BY sa.created_at DESC`,
    params
  );
  return rows;
}

export async function createAdjustment(
  input: z.infer<typeof createAdjustmentSchema>,
  createdBy: string,
  institutionId: string
) {
  return withTransaction(async (client) => {
    await applyMovement(client, {
      institutionId,
      itemId: input.itemId,
      type: "adjustment",
      change: input.quantity,
      refTable: "stock_adjustments",
      refId: undefined,
      note: input.note ?? null,
    });
    const { rows } = await client.query(
      `INSERT INTO stock_adjustments (institution_id, item_id, quantity, reason, note, approved_by, created_by)
       VALUES ($1, $2, $3, COALESCE($4, 'correction'), $5, $6, $7)
       RETURNING id, item_id AS "itemId", quantity, reason`,
      [
        institutionId,
        input.itemId,
        input.quantity,
        input.reason ?? null,
        input.note ?? null,
        input.approvedBy ?? null,
        createdBy,
      ]
    );
    await client.query(
      `UPDATE stock_movements SET ref_id = $1
       WHERE id = (SELECT id FROM stock_movements
                   WHERE institution_id = $2 AND item_id = $3 AND ref_table = 'stock_adjustments' AND ref_id IS NULL
                   ORDER BY created_at DESC LIMIT 1)`,
      [rows[0].id, institutionId, input.itemId]
    );
    return rows[0];
  });
}

// --- Movement history (audit) ---

export async function listMovements(itemId: string, institutionId: string) {
  const { rows } = await query(
    `SELECT m.id, m.type, m.change, m.balance_after AS "balanceAfter",
            m.ref_table AS "refTable", m.note, m.created_at AS "createdAt"
     FROM stock_movements m
     WHERE m.item_id = $1 AND m.institution_id = $2
     ORDER BY m.created_at, m.id`,
    [itemId, institutionId]
  );
  return rows;
}
