import { z } from "zod";

// Gateway configuration update (singleton). Secrets are write-only: an omitted or
// blank keySecret/webhookSecret leaves the stored value unchanged, so the masked
// settings form can be saved without re-entering them. provider is Razorpay-only
// for now (the build the user approved).
export const gatewaySettingsSchema = z
  .object({
    provider: z.enum(["razorpay"]).optional(),
    enabled: z.boolean().optional(),
    keyId: z.string().max(100).nullable().optional(),
    keySecret: z.string().max(200).optional(),
    webhookSecret: z.string().max(200).optional(),
    defaultCurrency: z.string().min(1).max(8).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

// Transactions list / report filters (query params arrive as strings).
export const transactionsQuerySchema = z.object({
  invoiceId: z.string().uuid().optional(),
  institutionId: z.string().uuid().optional(),
  status: z
    .enum(["created", "pending", "paid", "failed", "cancelled", "expired", "refunded"])
    .optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  format: z.enum(["json", "csv", "xlsx"]).default("json"),
});
