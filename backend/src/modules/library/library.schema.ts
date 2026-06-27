import { z } from "zod";

const COPY_STATUSES = ["available", "issued", "lost", "damaged", "retired"] as const;

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(40).nullish(),
});
export const updateCategorySchema = createCategorySchema.partial();

export const createBookSchema = z.object({
  categoryId: z.string().uuid().nullish(),
  isbn: z.string().max(40).nullish(),
  title: z.string().min(1).max(300),
  author: z.string().max(200).nullish(),
  publisher: z.string().max(200).nullish(),
  edition: z.string().max(80).nullish(),
  subject: z.string().max(120).nullish(),
  language: z.string().max(60).nullish(),
  rackLocation: z.string().max(80).nullish(),
  // Optionally auto-create this many copies with generated accession numbers.
  copyCount: z.coerce.number().int().min(0).max(1000).optional(),
});
export const updateBookSchema = createBookSchema.partial().omit({ copyCount: true });

export const createCopySchema = z.object({
  accessionNumber: z.string().min(1).max(60).optional(),
  barcode: z.string().max(80).nullish(),
});
export const updateCopySchema = z.object({
  accessionNumber: z.string().min(1).max(60).optional(),
  barcode: z.string().max(80).nullish(),
  status: z.enum(COPY_STATUSES).optional(),
});

export const createMemberSchema = z
  .object({
    memberType: z.enum(["student", "staff"]),
    studentId: z.string().uuid().nullish(),
    teacherId: z.string().uuid().nullish(),
    memberCode: z.string().max(60).nullish(),
  })
  .refine(
    (d) =>
      d.memberType === "student"
        ? !!d.studentId && !d.teacherId
        : !!d.teacherId && !d.studentId,
    { message: "Provide studentId for a student member, teacherId for staff" }
  );
export const updateMemberSchema = z.object({
  status: z.enum(["active", "inactive"]).optional(),
  memberCode: z.string().max(60).nullish(),
});

export const issueSchema = z
  .object({
    memberId: z.string().uuid(),
    copyId: z.string().uuid().optional(),
    bookId: z.string().uuid().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((d) => d.copyId || d.bookId, {
    message: "Provide a copyId or a bookId to issue",
  });

export const returnSchema = z.object({
  condition: z.enum(["ok", "lost", "damaged"]).optional(),
});

export const postFineSchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateSettingsSchema = z
  .object({
    loanDays: z.coerce.number().int().min(1).max(365).optional(),
    finePerDay: z.coerce.number().min(0).max(100000).optional(),
    maxRenewals: z.coerce.number().int().min(0).max(50).optional(),
    maxBooksPerMember: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });
