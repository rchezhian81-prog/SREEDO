import { z } from "zod";

export const createFeeStructureSchema = z.object({
  name: z.string().min(1).max(200),
  classId: z.string().uuid().nullable().optional(),
  academicYearId: z.string().uuid().nullable().optional(),
  amount: z.number().nonnegative(),
  frequency: z.enum(["one_time", "monthly", "term", "annual"]).optional(),
});

export const createInvoiceSchema = z.object({
  studentId: z.string().uuid(),
  feeStructureId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  amountDue: z.number().positive(),
  dueDate: z.string().date(),
});

export const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  studentId: z.string().uuid().optional(),
  status: z
    .enum(["pending", "partially_paid", "paid", "cancelled"])
    .optional(),
});

export const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z
    .enum(["cash", "card", "bank_transfer", "upi", "cheque", "online"])
    .optional(),
  reference: z.string().max(200).optional(),
});
