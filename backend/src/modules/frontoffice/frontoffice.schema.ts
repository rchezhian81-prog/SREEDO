import { z } from "zod";

// PR-T7 — Front-Office unification. Two NEW registers (postal/dispatch + call)
// that round out the front office; visitors/feedback/lost-found are reused as-is.

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// --- Postal / Dispatch register ---------------------------------------------
export const DISPATCH_DIRECTIONS = ["inbound", "outbound"] as const;
export const DISPATCH_ITEM_TYPES = ["letter", "parcel", "courier", "speed_post", "other"] as const;
export const DISPATCH_STATUSES = ["received", "dispatched", "delivered", "collected"] as const;

const dispatchBase = {
  direction: z.enum(DISPATCH_DIRECTIONS),
  itemType: z.enum(DISPATCH_ITEM_TYPES).optional(),
  refNo: z.string().max(80).optional(),
  partyName: z.string().min(1).max(200),
  addressee: z.string().max(200).optional(),
  carrier: z.string().max(120).optional(),
  trackingNo: z.string().max(120).optional(),
  itemDate: dateStr.optional(),
  status: z.enum(DISPATCH_STATUSES).optional(),
  remarks: z.string().max(2000).optional(),
  handledBy: z.string().uuid().optional(),
};

export const createDispatchSchema = z.object(dispatchBase);

export const updateDispatchSchema = z
  .object({
    ...dispatchBase,
    direction: z.enum(DISPATCH_DIRECTIONS).optional(),
    partyName: z.string().min(1).max(200).optional(),
  })
  .partial();

export const listDispatchQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  direction: z.enum(DISPATCH_DIRECTIONS).optional(),
  status: z.enum(DISPATCH_STATUSES).optional(),
  search: z.string().max(200).optional(),
  dateFrom: dateStr.optional(),
  dateTo: dateStr.optional(),
});

// --- Call register -----------------------------------------------------------
export const CALL_DIRECTIONS = ["incoming", "outgoing"] as const;
export const CALL_RELATED_TO = [
  "general", "admission", "enquiry", "complaint", "fees", "transport", "other",
] as const;

const callBase = {
  direction: z.enum(CALL_DIRECTIONS),
  callerName: z.string().min(1).max(200),
  phone: z.string().max(40).optional(),
  purpose: z.string().max(400).optional(),
  relatedTo: z.enum(CALL_RELATED_TO).optional(),
  followUpDate: dateStr.optional(),
  notes: z.string().max(2000).optional(),
  handledBy: z.string().uuid().optional(),
};

export const createCallSchema = z.object(callBase);

export const updateCallSchema = z
  .object({
    ...callBase,
    direction: z.enum(CALL_DIRECTIONS).optional(),
    callerName: z.string().min(1).max(200).optional(),
  })
  .partial();

export const listCallQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  direction: z.enum(CALL_DIRECTIONS).optional(),
  relatedTo: z.enum(CALL_RELATED_TO).optional(),
  search: z.string().max(200).optional(),
  dateFrom: dateStr.optional(),
  dateTo: dateStr.optional(),
});
