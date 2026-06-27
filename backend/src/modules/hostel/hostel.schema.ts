import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createHostelSchema = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(40),
  type: z.enum(["boys", "girls", "co_ed", "staff"]).optional(),
  address: z.string().max(400).nullish(),
  wardenName: z.string().max(160).nullish(),
  wardenPhone: z.string().max(40).nullish(),
  contactPhone: z.string().max(40).nullish(),
  capacity: z.coerce.number().int().min(0).max(100000).nullish(),
  isActive: z.boolean().optional(),
});
export const updateHostelSchema = createHostelSchema.partial();

export const createBlockSchema = z.object({
  name: z.string().min(1).max(120),
});
export const updateBlockSchema = createBlockSchema.partial();

export const createRoomSchema = z.object({
  roomNumber: z.string().min(1).max(40),
  blockId: z.string().uuid().nullish(),
  floor: z.string().max(40).nullish(),
  roomType: z.string().max(60).nullish(),
  capacity: z.coerce.number().int().min(0).max(100).optional(),
  status: z.enum(["available", "occupied", "maintenance", "inactive"]).optional(),
});
export const updateRoomSchema = createRoomSchema.partial();

export const createAllocationSchema = z.object({
  studentId: z.string().uuid(),
  hostelId: z.string().uuid(),
  roomId: z.string().uuid(),
  bedNo: z.string().max(40).nullish(),
  allocationDate: date.optional(),
});

export const transferSchema = z.object({
  roomId: z.string().uuid(),
  bedNo: z.string().max(40).nullish(),
});

export const setFeeSchema = z.object({
  hostelId: z.string().uuid(),
  roomType: z.string().max(60).nullish(),
  amount: z.coerce.number().min(0).max(10_000_000),
  frequency: z.enum(["monthly", "term", "annual"]).optional(),
});

export const generateInvoicesSchema = z.object({
  hostelId: z.string().uuid().optional(),
  dueDate: date,
  period: z.string().min(1).max(40),
  description: z.string().max(200).optional(),
});
