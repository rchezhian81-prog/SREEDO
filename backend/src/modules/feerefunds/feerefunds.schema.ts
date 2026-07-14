import { z } from "zod";

export const REFUND_METHODS = ["cash", "card", "bank_transfer", "upi", "cheque", "online"] as const;

export const createRefundSchema = z.object({
  paymentId: z.string().uuid(),
  amount: z.coerce.number().positive().max(99999999),
  // A fee reversal is high-risk — a reason is mandatory (T2.1).
  reason: z.string().trim().min(1, "A reason is required to reverse a payment").max(500),
  method: z.enum(REFUND_METHODS).optional(),
});

// Voiding a refund reverses a money event, so a reason is mandatory (audited).
export const voidRefundSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to void a refund").max(500),
});

export const listRefundsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
});

export const listPaymentsQuerySchema = z.object({
  search: z.string().max(200).optional(),
});
