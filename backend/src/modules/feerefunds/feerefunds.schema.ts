import { z } from "zod";

export const REFUND_METHODS = ["cash", "card", "bank_transfer", "upi", "cheque", "online"] as const;

export const createRefundSchema = z.object({
  paymentId: z.string().uuid(),
  amount: z.coerce.number().positive().max(99999999),
  reason: z.string().max(500).optional(),
  method: z.enum(REFUND_METHODS).optional(),
});

export const listRefundsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
});

export const listPaymentsQuerySchema = z.object({
  search: z.string().max(200).optional(),
});
