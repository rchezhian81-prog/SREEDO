import { z } from "zod";

/**
 * Credit & Debit note schemas (Billing P2). A note is a standalone document
 * linked to an issued/paid invoice. Lifecycle: draft → issue → void(reason).
 * Flat tax only — mirrors the invoice model.
 */

const money = z.number().min(0);

export const noteLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: money.optional(),
  unitPrice: money.optional(),
  sacCode: z.string().max(20).optional(),
});

// Edit a single DRAFT line (partial; at least one field required).
export const updateNoteLineSchema = z
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

export const createNoteSchema = z.object({
  kind: z.enum(["credit", "debit"]),
  reason: z.string().max(1000).optional(),
  currency: z.string().min(1).max(8).optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
  ...gstFields,
  lines: z.array(noteLineSchema).max(100).optional(),
});

// Edit a DRAFT note's header (all optional; nullable to clear a field).
export const updateNoteSchema = z
  .object({
    reason: z.string().max(1000).nullable().optional(),
    currency: z.string().min(1).max(8).optional(),
    taxPercent: z.number().min(0).max(100).optional(),
    notes: z.string().max(2000).nullable().optional(),
    sacCode: z.string().max(20).nullable().optional(),
    placeOfSupply: z.string().max(100).nullable().optional(),
    reverseCharge: z.boolean().optional(),
    recipientState: z.string().max(100).nullable().optional(),
    recipientStateCode: z.string().max(4).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

// Void requires a reason (audit + accounting correctness).
export const voidNoteSchema = z.object({
  reason: z.string().min(1).max(500),
});

// Per-invoice list: optional kind/status filter (no pagination needed).
export const noteListQuerySchema = z.object({
  kind: z.enum(["credit", "debit"]).optional(),
  status: z.enum(["draft", "issued", "void"]).optional(),
});
