import { z } from "zod";

const money = z.number().min(0);

export const invoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: money.optional(),
  unitPrice: money.optional(),
});

export const createInvoiceSchema = z.object({
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  currency: z.string().min(1).max(8).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(invoiceLineSchema).max(100).optional(),
});

export const markPaidSchema = z.object({
  paymentMethod: z.string().min(1).max(40),
  paidAt: z.string().date().optional(),
});

export const listInvoicesQuerySchema = z.object({
  status: z.enum(["draft", "issued", "paid", "void"]).optional(),
});
