import { z } from "zod";

export const TXN_TYPES = ["income", "expense"] as const;

export const createTransactionSchema = z.object({
  txnDate: z.string().date(),
  type: z.enum(TXN_TYPES),
  category: z.string().min(1).max(80),
  amount: z.coerce.number().positive().max(1_000_000_000),
  description: z.string().max(500).optional(),
  paymentMethod: z.string().max(40).optional(),
  referenceNo: z.string().max(80).optional(),
});

export const updateTransactionSchema = createTransactionSchema.partial();

export const listTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  type: z.enum(TXN_TYPES).optional(),
  category: z.string().max(80).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

export const summaryQuerySchema = z.object({
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});
