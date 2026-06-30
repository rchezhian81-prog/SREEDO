import type { z } from "zod";
import type { QueryResult } from "pg";
import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { recordSecurityEvent } from "../../utils/security-audit";
import type {
  createCouponSchema,
  updateCouponSchema,
  couponStatusSchema,
  couponListQuerySchema,
} from "./coupons.schema";

export interface Actor {
  id: string;
  email: string;
  role: string;
  ip: string | null;
}

type Executor = (text: string, params?: unknown[]) => Promise<QueryResult>;

const COUPON_COLUMNS = `
  id, code, name, description,
  discount_type AS "discountType", discount_value AS "discountValue",
  max_discount_amount AS "maxDiscountAmount", min_invoice_amount AS "minInvoiceAmount",
  valid_from AS "validFrom", valid_until AS "validUntil",
  total_usage_limit AS "totalUsageLimit", per_tenant_usage_limit AS "perTenantUsageLimit",
  applicable_packages AS "applicablePackages", applicable_types AS "applicableTypes",
  applicable_billing_cycles AS "applicableBillingCycles",
  status, internal_notes AS "internalNotes",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const COUPON_COLUMN_MAP: Record<string, string> = {
  code: "code", name: "name", description: "description",
  discountType: "discount_type", discountValue: "discount_value",
  maxDiscountAmount: "max_discount_amount", minInvoiceAmount: "min_invoice_amount",
  validFrom: "valid_from", validUntil: "valid_until",
  totalUsageLimit: "total_usage_limit", perTenantUsageLimit: "per_tenant_usage_limit",
  applicablePackages: "applicable_packages", applicableTypes: "applicable_types",
  applicableBillingCycles: "applicable_billing_cycles",
  status: "status", internalNotes: "internal_notes",
};

const COUPON_SORTS: Record<string, string> = {
  code: "code", status: "status", createdAt: "created_at", validUntil: "valid_until",
};

async function auditCoupon(action: string, couponId: string, detail: Record<string, unknown>, actor: Actor) {
  await recordSecurityEvent({
    action, targetType: "coupon", targetId: couponId,
    actorId: actor.id, actorEmail: actor.email, actorRole: actor.role,
    detail, ip: actor.ip,
  });
}

export async function listCoupons(filter: z.infer<typeof couponListQuerySchema> = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.q) { params.push(`%${filter.q.toLowerCase()}%`); where.push(`(lower(code) LIKE $${params.length} OR lower(coalesce(name,'')) LIKE $${params.length})`); }
  if (filter.status) { params.push(filter.status); where.push(`status = $${params.length}`); }
  if (filter.discountType) { params.push(filter.discountType); where.push(`discount_type = $${params.length}`); }
  const sortCol = COUPON_SORTS[filter.sort ?? "createdAt"] ?? "created_at";
  const order = filter.order === "asc" ? "ASC" : "DESC";
  const { rows } = await query(
    `SELECT ${COUPON_COLUMNS},
            (SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_id = coupons.id) AS "usedCount"
     FROM coupons ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${sortCol} ${order}, code ASC`,
    params
  );
  return rows;
}

export async function getCoupon(id: string) {
  const { rows } = await query(`SELECT ${COUPON_COLUMNS} FROM coupons WHERE id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Coupon not found");
  return rows[0];
}

export async function createCoupon(input: z.infer<typeof createCouponSchema>, actor: Actor) {
  const data = input as Record<string, unknown>;
  if (typeof data.code === "string") data.code = data.code.toUpperCase();
  const cols: string[] = [];
  const vals: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(COUPON_COLUMN_MAP)) {
    if (field in data) { params.push(data[field]); cols.push(col); vals.push(`$${params.length}`); }
  }
  params.push(actor.id); cols.push("updated_by"); vals.push(`$${params.length}`);
  let rows;
  try {
    ({ rows } = await query(
      `INSERT INTO coupons (${cols.join(", ")}) VALUES (${vals.join(", ")}) RETURNING ${COUPON_COLUMNS}`,
      params
    ));
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw ApiError.conflict("A coupon with this code already exists");
    throw err;
  }
  await auditCoupon("coupon.created", rows[0].id, { code: rows[0].code, status: rows[0].status }, actor);
  return rows[0];
}

export async function updateCoupon(id: string, input: z.infer<typeof updateCouponSchema>, actor: Actor) {
  await getCoupon(id);
  const data = input as Record<string, unknown>;
  if (typeof data.code === "string") data.code = data.code.toUpperCase();
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(COUPON_COLUMN_MAP)) {
    if (field in data) { params.push(data[field]); sets.push(`${col} = $${params.length}`); }
  }
  if (!sets.length) throw ApiError.badRequest("No fields to update");
  params.push(actor.id); sets.push(`updated_at = now()`, `updated_by = $${params.length}`);
  params.push(id);
  let rows;
  try {
    ({ rows } = await query(
      `UPDATE coupons SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING ${COUPON_COLUMNS}`,
      params
    ));
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw ApiError.conflict("A coupon with this code already exists");
    throw err;
  }
  await auditCoupon("coupon.updated", id, { fields: Object.keys(data) }, actor);
  return rows[0];
}

export async function setCouponStatus(id: string, input: z.infer<typeof couponStatusSchema>, actor: Actor) {
  const before = await getCoupon(id);
  if ((input.status === "disabled" || input.status === "expired") && !input.reason?.trim()) {
    throw ApiError.badRequest("A reason is required to disable or expire a coupon");
  }
  const { rows } = await query(
    `UPDATE coupons SET status = $1, updated_at = now(), updated_by = $2 WHERE id = $3 RETURNING ${COUPON_COLUMNS}`,
    [input.status, actor.id, id]
  );
  await auditCoupon("coupon.status_change", id, {
    from: (before as Record<string, unknown>).status, to: input.status, reason: input.reason ?? null,
  }, actor);
  return rows[0];
}

/** Pure discount math: pre-tax, capped at subtotal, 2dp. */
export function computeDiscount(coupon: Record<string, unknown>, subtotal: number): number {
  const sub = Number(subtotal) || 0;
  let d = 0;
  if (coupon.discountType === "percentage") {
    d = (sub * Number(coupon.discountValue)) / 100;
    if (coupon.maxDiscountAmount != null) d = Math.min(d, Number(coupon.maxDiscountAmount));
  } else {
    d = Number(coupon.discountValue);
  }
  d = Math.min(d, sub); // never below zero total
  return Math.round(d * 100) / 100;
}

export async function countRedemptions(couponId: string, institutionId?: string | null): Promise<number> {
  const params: unknown[] = [couponId];
  let sql = `SELECT count(*)::int AS c FROM coupon_redemptions WHERE coupon_id = $1`;
  if (institutionId) { params.push(institutionId); sql += ` AND institution_id = $2`; }
  const { rows } = await query<{ c: number }>(sql, params);
  return rows[0]?.c ?? 0;
}

export interface CouponContext {
  code: string;
  subtotal: number;
  packageId?: string | null;
  institutionType?: string | null;
  billingCycle?: string | null;
  institutionId?: string | null;
}

/**
 * Validate a coupon against an invoice context and return the coupon + computed
 * discount, or throw ApiError(400). Used at apply-time and re-checked at issue.
 */
export async function validateCoupon(ctx: CouponContext): Promise<{ coupon: Record<string, unknown>; discount: number }> {
  const { rows } = await query(`SELECT ${COUPON_COLUMNS} FROM coupons WHERE lower(code) = lower($1)`, [ctx.code.trim()]);
  const coupon = rows[0] as Record<string, unknown> | undefined;
  if (!coupon) throw ApiError.badRequest("Coupon not found");
  if (coupon.status !== "active") throw ApiError.badRequest("This coupon is not active");

  const today = new Date().toISOString().slice(0, 10);
  if (coupon.validFrom && today < String(coupon.validFrom).slice(0, 10)) throw ApiError.badRequest("This coupon is not valid yet");
  if (coupon.validUntil && today > String(coupon.validUntil).slice(0, 10)) throw ApiError.badRequest("This coupon has expired");

  if (coupon.minInvoiceAmount != null && Number(ctx.subtotal) < Number(coupon.minInvoiceAmount)) {
    throw ApiError.badRequest(`A minimum amount of ${coupon.minInvoiceAmount} is required for this coupon`);
  }
  const pkgs = (coupon.applicablePackages as string[]) ?? [];
  if (pkgs.length && (!ctx.packageId || !pkgs.includes(ctx.packageId))) {
    throw ApiError.badRequest("This coupon does not apply to the invoice's package");
  }
  const types = (coupon.applicableTypes as string[]) ?? [];
  if (types.length && (!ctx.institutionType || !types.includes(ctx.institutionType))) {
    throw ApiError.badRequest("This coupon does not apply to this institution type");
  }
  const cycles = (coupon.applicableBillingCycles as string[]) ?? [];
  if (cycles.length && (!ctx.billingCycle || !cycles.includes(ctx.billingCycle))) {
    throw ApiError.badRequest("This coupon does not apply to this billing cycle");
  }
  if (coupon.totalUsageLimit != null) {
    const used = await countRedemptions(String(coupon.id));
    if (used >= Number(coupon.totalUsageLimit)) throw ApiError.badRequest("This coupon has reached its total usage limit");
  }
  if (coupon.perTenantUsageLimit != null && ctx.institutionId) {
    const usedT = await countRedemptions(String(coupon.id), ctx.institutionId);
    if (usedT >= Number(coupon.perTenantUsageLimit)) throw ApiError.badRequest("This coupon has reached its per-tenant usage limit");
  }
  const discount = computeDiscount(coupon, Number(ctx.subtotal));
  if (discount <= 0) throw ApiError.badRequest("This coupon yields no discount on this invoice");
  return { coupon, discount };
}

/** Record one redemption (called inside issueInvoice's transaction). */
export async function recordRedemption(
  exec: Executor,
  args: { couponId: string; invoiceId: string; institutionId: string | null; code: string; discount: number }
): Promise<void> {
  await exec(
    `INSERT INTO coupon_redemptions (coupon_id, invoice_id, institution_id, code, discount_amount)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (invoice_id) WHERE invoice_id IS NOT NULL DO NOTHING`,
    [args.couponId, args.invoiceId, args.institutionId, args.code, args.discount]
  );
}

export async function couponUsage(id: string) {
  await getCoupon(id);
  const { rows } = await query(
    `SELECT r.id, r.invoice_id AS "invoiceId", r.institution_id AS "institutionId",
            i.name AS "institutionName", inv.number AS "invoiceNumber",
            r.discount_amount AS "discountAmount", r.redeemed_at AS "redeemedAt"
     FROM coupon_redemptions r
     LEFT JOIN institutions i ON i.id = r.institution_id
     LEFT JOIN saas_invoices inv ON inv.id = r.invoice_id
     WHERE r.coupon_id = $1 ORDER BY r.redeemed_at DESC`,
    [id]
  );
  const totals = await query<{ used: number; discount: string }>(
    `SELECT count(*)::int AS used, coalesce(sum(discount_amount),0) AS discount FROM coupon_redemptions WHERE coupon_id = $1`,
    [id]
  );
  return { redemptions: rows, used: totals.rows[0]?.used ?? 0, totalDiscount: totals.rows[0]?.discount ?? "0" };
}

export const COUPON_USAGE_REPORT_COLUMNS = [
  { key: "code", label: "Code" }, { key: "status", label: "Status" },
  { key: "discountType", label: "Type" }, { key: "discountValue", label: "Value" },
  { key: "used", label: "Times used" }, { key: "totalDiscount", label: "Total discount" },
];

export async function couponUsageReport() {
  const { rows } = await query(
    `SELECT c.id, c.code, c.status, c.discount_type AS "discountType", c.discount_value AS "discountValue",
            coalesce(u.used, 0) AS used, coalesce(u.discount, 0) AS "totalDiscount"
     FROM coupons c
     LEFT JOIN (
       SELECT coupon_id, count(*)::int AS used, sum(discount_amount) AS discount
       FROM coupon_redemptions GROUP BY coupon_id
     ) u ON u.coupon_id = c.id
     ORDER BY used DESC, c.code ASC`
  );
  return rows;
}
