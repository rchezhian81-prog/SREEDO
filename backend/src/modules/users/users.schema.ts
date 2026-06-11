import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Za-z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a digit"),
  fullName: z.string().min(1).max(200),
  role: z.enum(["admin", "teacher", "accountant", "student", "parent"]),
  phone: z.string().max(30).optional(),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).nullable().optional(),
  role: z
    .enum(["admin", "teacher", "accountant", "student", "parent"])
    .optional(),
  isActive: z.boolean().optional(),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  role: z
    .enum(["admin", "teacher", "accountant", "student", "parent"])
    .optional(),
  search: z.string().max(200).optional(),
});
