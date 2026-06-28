import { z } from "zod";

const money = z.number().min(0);

export const invoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: money.optional(),
  unitPrice: money.optional(),
});

export const createInvoiceSchema = z.object({
  packageId: z.string().uuid().optional(),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  currency: z.string().min(1).max(8).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  // Optional billing details (printed on the PDF). Flat tax only for now.
  gstin: z.string().max(20).optional(),
  billingName: z.string().max(200).optional(),
  billingAddress: z.string().max(1000).optional(),
  taxNotes: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(invoiceLineSchema).max(100).optional(),
});

// Edit a DRAFT invoice's header (all optional; nullable to clear a field).
export const updateInvoiceSchema = z
  .object({
    packageId: z.string().uuid().nullable().optional(),
    currency: z.string().min(1).max(8).optional(),
    periodStart: z.string().date().nullable().optional(),
    periodEnd: z.string().date().nullable().optional(),
    taxPercent: z.number().min(0).max(100).optional(),
    gstin: z.string().max(20).nullable().optional(),
    billingName: z.string().max(200).nullable().optional(),
    billingAddress: z.string().max(1000).nullable().optional(),
    taxNotes: z.string().max(1000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export const markPaidSchema = z.object({
  paymentMethod: z.string().min(1).max(40),
  reference: z.string().max(200).optional(),
  paidAt: z.string().date().optional(),
});

export const listInvoicesQuerySchema = z.object({
  status: z.enum(["draft", "issued", "paid", "void"]).optional(),
});
