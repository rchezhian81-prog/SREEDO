import { z } from "zod";

const uuid = z.string().uuid();

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
});
export const updateCategorySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const createScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  categoryId: uuid.nullable().optional(),
  amount: z.number().nonnegative(),
  termType: z
    .enum(["one_time", "monthly", "quarterly", "term", "annual"])
    .optional(),
  termLabel: z.string().max(80).nullable().optional(),
  dueDate: z.string().date(),
  academicYearId: uuid.nullable().optional(),
  classId: uuid.nullable().optional(),
  sectionId: uuid.nullable().optional(),
  programId: uuid.nullable().optional(),
  semesterId: uuid.nullable().optional(),
  studentId: uuid.nullable().optional(),
});
export const updateScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  amount: z.number().nonnegative().optional(),
  termLabel: z.string().max(80).nullable().optional(),
  dueDate: z.string().date().optional(),
  isActive: z.boolean().optional(),
});

export const createFineRuleSchema = z.object({
  name: z.string().min(1).max(200),
  categoryId: uuid.nullable().optional(),
  fineType: z.enum(["fixed", "per_day", "percent"]),
  amount: z.number().nonnegative(),
  graceDays: z.number().int().min(0).max(365).optional(),
});

export const applyFineSchema = z.object({
  fineRuleId: uuid.optional(),
  amount: z.number().nonnegative().optional(),
  reason: z.string().max(300).optional(),
});

export const waiveSchema = z.object({
  reason: z.string().max(300).optional(),
});

export const createDiscountSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["discount", "scholarship"]).optional(),
  discountType: z.enum(["fixed", "percent"]),
  value: z.number().nonnegative(),
  categoryId: uuid.nullable().optional(),
});

export const applyDiscountSchema = z
  .object({
    discountId: uuid.optional(),
    discountType: z.enum(["fixed", "percent"]).optional(),
    value: z.number().nonnegative().optional(),
    reason: z.string().max(300).optional(),
  })
  .refine((v) => v.discountId != null || (v.discountType != null && v.value != null), {
    message: "Provide a discountId or a discountType + value",
  });
