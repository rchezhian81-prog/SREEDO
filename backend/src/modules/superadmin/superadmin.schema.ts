import { z } from "zod";

export const createInstitutionSchema = z.object({
  name: z.string().min(1).max(200),
  code: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may use letters, digits, - and _")
    .transform((value) => value.toUpperCase()),
  type: z.enum(["school", "college"]).optional(),
  settings: z.record(z.unknown()).optional(),
});

export const updateInstitutionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(["school", "college"]).optional(),
  isActive: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const createBranchSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  timezone: z.string().max(60).optional(),
});

export const updateBranchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).nullable().optional(),
  timezone: z.string().max(60).optional(),
  isActive: z.boolean().optional(),
});

export const createPackageSchema = z.object({
  name: z.string().min(1).max(120),
  maxStudents: z.number().int().nonnegative().nullable().optional(),
  maxStaff: z.number().int().nonnegative().nullable().optional(),
  price: z.number().nonnegative().optional(),
  billingCycle: z.enum(["monthly", "quarterly", "annual"]).optional(),
  features: z.record(z.unknown()).optional(),
});

export const updatePackageSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  maxStudents: z.number().int().nonnegative().nullable().optional(),
  maxStaff: z.number().int().nonnegative().nullable().optional(),
  price: z.number().nonnegative().optional(),
  billingCycle: z.enum(["monthly", "quarterly", "annual"]).optional(),
  features: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const assignSubscriptionSchema = z.object({
  packageId: z.string().uuid(),
  status: z.enum(["active", "trialing", "suspended", "cancelled"]).optional(),
  startsAt: z.string().date().optional(),
  endsAt: z.string().date().nullable().optional(),
});
