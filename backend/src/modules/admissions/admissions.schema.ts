import { z } from "zod";

export const ADMISSION_STATUSES = [
  "enquiry",
  "applied",
  "under_review",
  "admitted",
  "rejected",
  "enrolled",
] as const;

const GENDERS = ["male", "female", "other"] as const;

// Applicant fields shared by the admin create form and the public enquiry form.
const applicantFields = {
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().date().optional(),
  gender: z.enum(GENDERS).optional(),
  gradeApplying: z.string().max(60).optional(),
  guardianName: z.string().max(200).optional(),
  guardianPhone: z.string().max(30).optional(),
  guardianEmail: z.string().email().optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
};

export const createAdmissionSchema = z.object({
  ...applicantFields,
  source: z.string().max(60).optional(),
  status: z.enum(ADMISSION_STATUSES).optional(),
  sectionId: z.string().uuid().nullable().optional(),
});

export const updateAdmissionSchema = createAdmissionSchema.partial();

export const listAdmissionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: z.enum(ADMISSION_STATUSES).optional(),
  search: z.string().max(200).optional(),
});

export const convertAdmissionSchema = z.object({
  sectionId: z.string().uuid().nullable().optional(),
  admissionNo: z.string().min(1).max(50).optional(),
});

// Public enquiry (no auth): a prospective family submits interest. The school is
// resolved by its public code; the record is always created with status=enquiry.
export const publicEnquirySchema = z.object({
  institutionCode: z.string().min(2).max(40),
  ...applicantFields,
});
