import { z } from "zod";

const money = z.number().min(0);

export const invoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: money.optional(),
  unitPrice: money.optional(),
  sacCode: z.string().max(20).optional(),
});

// Edit a single DRAFT line (partial; at least one field required).
export const updateLineSchema = z
  .object({
    description: z.string().min(1).max(500).optional(),
    quantity: money.optional(),
    unitPrice: money.optional(),
    sacCode: z.string().max(20).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

// GST-readiness fields (stored + printed; flat tax calculation is unchanged).
const gstFields = {
  sacCode: z.string().max(20).optional(),
  placeOfSupply: z.string().max(100).optional(),
  reverseCharge: z.boolean().optional(),
  recipientState: z.string().max(100).optional(),
  recipientStateCode: z.string().max(4).optional(),
};

export const createInvoiceSchema = z.object({
  packageId: z.string().uuid().optional(),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  // Net payment terms in days — used to auto-compute the due date on issue when
  // an explicit dueDate is not given. Optional.
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  dueDate: z.string().date().optional(),
  currency: z.string().min(1).max(8).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  // Optional billing details (printed on the PDF). Flat tax only for now.
  gstin: z.string().max(20).optional(),
  billingName: z.string().max(200).optional(),
  billingAddress: z.string().max(1000).optional(),
  taxNotes: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  ...gstFields,
  lines: z.array(invoiceLineSchema).max(100).optional(),
});

// Edit a DRAFT invoice's header (all optional; nullable to clear a field).
export const updateInvoiceSchema = z
  .object({
    packageId: z.string().uuid().nullable().optional(),
    currency: z.string().min(1).max(8).optional(),
    periodStart: z.string().date().nullable().optional(),
    periodEnd: z.string().date().nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
    dueDate: z.string().date().nullable().optional(),
    taxPercent: z.number().min(0).max(100).optional(),
    gstin: z.string().max(20).nullable().optional(),
    billingName: z.string().max(200).nullable().optional(),
    billingAddress: z.string().max(1000).nullable().optional(),
    taxNotes: z.string().max(1000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    sacCode: z.string().max(20).nullable().optional(),
    placeOfSupply: z.string().max(100).nullable().optional(),
    reverseCharge: z.boolean().optional(),
    recipientState: z.string().max(100).nullable().optional(),
    recipientStateCode: z.string().max(4).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export const markPaidSchema = z.object({
  paymentMethod: z.string().min(1).max(40),
  reference: z.string().max(200).optional(),
  paidAt: z.string().date().optional(),
});

// Void requires a reason (audit + accounting correctness).
export const voidInvoiceSchema = z.object({
  reason: z.string().min(1).max(500),
});

// Platform invoice settings (singleton) — all fields optional for partial update.
export const invoiceSettingsSchema = z
  .object({
    prefix: z.string().min(1).max(16).optional(),
    fyStartMonth: z.number().int().min(1).max(12).optional(),
    numberPadding: z.number().int().min(1).max(12).optional(),
    defaultCurrency: z.string().min(1).max(8).optional(),
    defaultTaxPercent: z.number().min(0).max(100).optional(),
    defaultSac: z.string().max(20).nullable().optional(),
    defaultDueDays: z.number().int().min(0).max(365).nullable().optional(),
    supplierLegalName: z.string().max(200).nullable().optional(),
    supplierTradeName: z.string().max(200).nullable().optional(),
    supplierAddress: z.string().max(1000).nullable().optional(),
    supplierGstin: z.string().max(20).nullable().optional(),
    supplierPan: z.string().max(20).nullable().optional(),
    supplierState: z.string().max(100).nullable().optional(),
    supplierStateCode: z.string().max(4).nullable().optional(),
    supplierEmail: z.string().max(200).nullable().optional(),
    supplierPhone: z.string().max(40).nullable().optional(),
    bankDetails: z.string().max(1000).nullable().optional(),
    upiId: z.string().max(100).nullable().optional(),
    pdfFooter: z.string().max(1000).nullable().optional(),
    pdfTerms: z.string().max(2000).nullable().optional(),
    signatoryName: z.string().max(200).nullable().optional(),
    logoPath: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

// Global invoice list: status/institution/overdue/date/search filters with
// pagination + sorting. Query params arrive as strings, so coerce numbers/bools.
export const listInvoicesQuerySchema = z.object({
  status: z.enum(["draft", "issued", "paid", "void"]).optional(),
  institutionId: z.string().uuid().optional(),
  overdue: z.coerce.boolean().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(["createdAt", "dueDate", "total", "number", "status"])
    .default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

// Per-institution list: just the status filter (no pagination needed).
export const institutionInvoicesQuerySchema = z.object({
  status: z.enum(["draft", "issued", "paid", "void"]).optional(),
});
