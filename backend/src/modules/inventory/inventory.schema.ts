import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(40).nullish(),
});
export const updateCategorySchema = createCategorySchema.partial();

export const createVendorSchema = z.object({
  name: z.string().min(1).max(200),
  contactPerson: z.string().max(160).nullish(),
  phone: z.string().max(40).nullish(),
  email: z.string().max(160).nullish(),
  gstNumber: z.string().max(40).nullish(),
  address: z.string().max(400).nullish(),
  paymentTerms: z.string().max(200).nullish(),
  isActive: z.boolean().optional(),
});
export const updateVendorSchema = createVendorSchema.partial();

export const createItemSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(40),
  categoryId: z.string().uuid().nullish(),
  unit: z.string().max(40).nullish(),
  openingStock: z.coerce.number().min(0).max(1_000_000_000).optional(),
  minStockLevel: z.coerce.number().min(0).max(1_000_000_000).optional(),
  location: z.string().max(120).nullish(),
  isActive: z.boolean().optional(),
});
// opening stock is only meaningful at creation; it cannot be edited later
// (use a stock adjustment instead).
export const updateItemSchema = createItemSchema.partial().omit({ openingStock: true });

const purchaseLineSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.coerce.number().positive().max(1_000_000_000),
  rate: z.coerce.number().min(0).max(1_000_000_000).optional(),
});

export const createPurchaseSchema = z.object({
  vendorId: z.string().uuid().nullish(),
  purchaseDate: date.optional(),
  billNo: z.string().max(80).nullish(),
  documentId: z.string().uuid().nullish(),
  notes: z.string().max(500).nullish(),
  items: z.array(purchaseLineSchema).min(1),
});

export const createIssueSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.coerce.number().positive().max(1_000_000_000),
  issuedToType: z.enum(["department", "staff", "student", "event", "other"]).optional(),
  issuedTo: z.string().max(200).nullish(),
  purpose: z.string().max(300).nullish(),
  receivedBy: z.string().max(160).nullish(),
  issueDate: date.optional(),
});

export const createAdjustmentSchema = z.object({
  itemId: z.string().uuid(),
  // Signed delta: negative reduces stock (damage/lost), positive corrects up.
  quantity: z.coerce.number().refine((v) => v !== 0, "Quantity cannot be zero"),
  reason: z.enum(["damage", "lost", "correction"]).optional(),
  note: z.string().max(300).nullish(),
  approvedBy: z.string().max(160).nullish(),
});
