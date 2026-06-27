import { z } from "zod";

const month = z.string().regex(/^\d{4}-\d{2}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const calcType = z.enum(["fixed", "percent"]);

export const createComponentSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(40),
  type: z.enum(["earning", "deduction"]),
  calcType: calcType.optional(),
  defaultValue: z.coerce.number().min(0).max(100_000_000).optional(),
  isActive: z.boolean().optional(),
});
export const updateComponentSchema = createComponentSchema.partial().omit({ type: true });

const structureLineSchema = z.object({
  componentId: z.string().uuid(),
  calcType: calcType.optional(),
  value: z.coerce.number().min(0).max(100_000_000),
});

export const createStructureSchema = z.object({
  teacherId: z.string().uuid(),
  effectiveDate: date.optional(),
  components: z.array(structureLineSchema).min(1),
});

export const runPayrollSchema = z.object({
  month,
  recalc: z.boolean().optional(),
});
