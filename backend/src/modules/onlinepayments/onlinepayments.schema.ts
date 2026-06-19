import { z } from "zod";

export const createOrderSchema = z.object({
  invoiceId: z.string().uuid(),
  // Optional client-declared amount; the server always charges the invoice's
  // outstanding balance and rejects a mismatch (anti-tampering).
  amount: z.number().positive().optional(),
});

export const listOrdersQuerySchema = z.object({
  status: z
    .enum(["created", "pending", "success", "failed", "cancelled", "expired", "refunded"])
    .optional(),
  invoiceId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
});

export const settingsPatchSchema = z.object({
  enabled: z.boolean(),
});
