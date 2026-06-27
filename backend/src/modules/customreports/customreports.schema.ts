import { z } from "zod";

// Mirrors the Reports Center Filters interface (all optional).
export const filtersSchema = z
  .object({
    classId: z.string().optional(),
    sectionId: z.string().optional(),
    studentId: z.string().optional(),
    staffId: z.string().optional(),
    status: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    examId: z.string().optional(),
    subjectId: z.string().optional(),
    category: z.string().optional(),
    ownerType: z.string().optional(),
    search: z.string().optional(),
    programId: z.string().optional(),
    semesterId: z.string().optional(),
    departmentId: z.string().optional(),
    memberId: z.string().optional(),
    routeId: z.string().optional(),
    stopId: z.string().optional(),
    hostelId: z.string().optional(),
    roomId: z.string().optional(),
    itemId: z.string().optional(),
    vendorId: z.string().optional(),
    teacherId: z.string().optional(),
    month: z.string().optional(),
  })
  .strict();

export const sortSchema = z.object({
  key: z.string().min(1).max(80),
  dir: z.enum(["asc", "desc"]),
});

export const createCustomReportSchema = z.object({
  name: z.string().min(1).max(200),
  reportKey: z.string().min(1).max(100),
  columns: z.array(z.string().max(80)).max(60).optional(),
  filters: filtersSchema.optional(),
  sort: sortSchema.nullable().optional(),
  groupBy: z.string().max(80).nullable().optional(),
  visibility: z.enum(["private", "shared"]).optional(),
});

export const updateCustomReportSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  columns: z.array(z.string().max(80)).max(60).optional(),
  filters: filtersSchema.optional(),
  sort: sortSchema.nullable().optional(),
  groupBy: z.string().max(80).nullable().optional(),
  visibility: z.enum(["private", "shared"]).optional(),
});

export const adhocSchema = z.object({
  reportKey: z.string().min(1).max(100),
  columns: z.array(z.string().max(80)).max(60).optional(),
  filters: filtersSchema.optional(),
  sort: sortSchema.nullable().optional(),
});

export const exportQuerySchema = z.object({
  format: z.enum(["csv", "pdf"]).optional(),
});
