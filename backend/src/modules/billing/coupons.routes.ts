import type { Request, Response } from "express";
import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { clientIp } from "../../utils/security-audit";
import { uuidParam } from "../../utils/params";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import * as service from "./coupons.service";
import {
  createCouponSchema,
  updateCouponSchema,
  couponStatusSchema,
  couponListQuerySchema,
  couponUsageQuerySchema,
} from "./coupons.schema";

// Super-admin-only billing control. authorize("super_admin") is the hard
// boundary; requirePermission enforces the granular platform:* model on top.
export const couponsRouter = Router();
couponsRouter.use(authenticate, authorize("super_admin"));

const actor = (req: Request): service.Actor => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: clientIp(req),
});

function sendSpreadsheet(
  res: Response,
  format: "csv" | "xlsx",
  filename: string,
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[]
) {
  const header = columns.map((c) => c.label);
  const body = rows.map((r) => columns.map((c) => (r[c.key] ?? "") as Cell));
  if (format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(toXlsx(header, body));
  } else {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(toCsv(header, body));
  }
}

/**
 * @openapi
 * /coupons-usage-report:
 *   get:
 *     tags: [Coupons]
 *     summary: Per-coupon usage + total discount (JSON, or ?format=csv|xlsx)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Coupon usage report } }
 */
couponsRouter.get("/coupons-usage-report", requirePermission("platform:read"), async (req, res) => {
  const q = couponUsageQuerySchema.parse(req.query);
  const rows = await service.couponUsageReport();
  if (q.format) {
    return sendSpreadsheet(res, q.format, "coupon-usage", service.COUPON_USAGE_REPORT_COLUMNS, rows as Record<string, unknown>[]);
  }
  res.json(rows);
});

/**
 * @openapi
 * /coupons:
 *   get:
 *     tags: [Coupons]
 *     summary: List coupons (search/filter/sort)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Coupons } }
 *   post:
 *     tags: [Coupons]
 *     summary: Create a coupon
 *     security: [{ bearerAuth: [] }]
 *     responses: { 201: { description: Created coupon } }
 */
couponsRouter.get("/coupons", requirePermission("platform:read"), async (req, res) => {
  res.json(await service.listCoupons(couponListQuerySchema.parse(req.query)));
});
couponsRouter.post("/coupons", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.status(201).json(await service.createCoupon(createCouponSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /coupons/{id}:
 *   get:
 *     tags: [Coupons]
 *     summary: Get a coupon
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Coupon } }
 *   patch:
 *     tags: [Coupons]
 *     summary: Edit a coupon (audited)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated coupon } }
 */
couponsRouter.get("/coupons/:id", requirePermission("platform:read"), async (req, res) => {
  res.json(await service.getCoupon(uuidParam(req)));
});
couponsRouter.patch("/coupons/:id", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.json(await service.updateCoupon(uuidParam(req), updateCouponSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /coupons/{id}/status:
 *   post:
 *     tags: [Coupons]
 *     summary: Change coupon status (disable/expire require a reason; audited)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Updated coupon } }
 */
couponsRouter.post("/coupons/:id/status", requirePermission("platform:manage_subscriptions"), async (req, res) => {
  res.json(await service.setCouponStatus(uuidParam(req), couponStatusSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /coupons/{id}/usage:
 *   get:
 *     tags: [Coupons]
 *     summary: Coupon redemption history + totals
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses: { 200: { description: Redemptions } }
 */
couponsRouter.get("/coupons/:id/usage", requirePermission("platform:read"), async (req, res) => {
  res.json(await service.couponUsage(uuidParam(req)));
});
