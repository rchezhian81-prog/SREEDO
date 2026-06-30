import { z } from "zod";

export const DISCOUNT_TYPES = ["percentage", "fixed"] as const;
export const COUPON_STATUSES = ["draft", "active", "expired", "disabled"] as const;
export const COUPON_INSTITUTION_TYPES = ["school", "college", "university", "coaching", "other"] as const;
export const COUPON_BILLING_CYCLES = ["monthly", "quarterly", "half_yearly", "annual"] as const;

const couponBase = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/, "Code may use letters, numbers, _ and - only"),
  name: z.string().max(120).nullable(),
  description: z.string().max(2000).nullable(),
  discountType: z.enum(DISCOUNT_TYPES),
  discountValue: z.number().nonnegative(),
  maxDiscountAmount: z.number().nonnegative().nullable(),
  minInvoiceAmount: z.number().nonnegative().nullable(),
  validFrom: z.string().date().nullable(),
  validUntil: z.string().date().nullable(),
  totalUsageLimit: z.number().int().nonnegative().nullable(),
  perTenantUsageLimit: z.number().int().nonnegative().nullable(),
  applicablePackages: z.array(z.string().uuid()).max(100),
  applicableTypes: z.array(z.enum(COUPON_INSTITUTION_TYPES)).max(5),
  applicableBillingCycles: z.array(z.enum(COUPON_BILLING_CYCLES)).max(4),
  status: z.enum(COUPON_STATUSES),
  internalNotes: z.string().max(2000).nullable(),
});

// A percentage coupon's value must be <= 100 (mirrors the DB CHECK).
const percentRule = (v: { discountType?: string; discountValue?: number }) =>
  v.discountType !== "percentage" || v.discountValue === undefined || v.discountValue <= 100;
const percentMsg = { message: "A percentage discount cannot exceed 100" };

export const createCouponSchema = couponBase
  .partial()
  .required({ code: true, discountType: true, discountValue: true })
  .refine(percentRule, percentMsg);

export const updateCouponSchema = couponBase
  .omit({ status: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" })
  .refine(percentRule, percentMsg);

export const couponStatusSchema = z.object({
  status: z.enum(COUPON_STATUSES),
  reason: z.string().max(500).optional(),
});

export const couponListQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(COUPON_STATUSES).optional(),
  discountType: z.enum(DISCOUNT_TYPES).optional(),
  sort: z.enum(["code", "status", "createdAt", "validUntil"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const applyCouponSchema = z.object({
  code: z.string().trim().min(2).max(40),
});

export const couponUsageQuerySchema = z.object({
  format: z.enum(["csv", "xlsx"]).optional(),
});
