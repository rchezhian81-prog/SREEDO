import { z } from "zod";

// Raw CSV text is sent in a JSON body (no multipart dependency); parsed + validated
// server-side. 5 MB text cap is a defensive bound well above the 1000-row limit.
export const importBodySchema = z.object({
  csv: z.string().min(1, "CSV content is required").max(5_000_000, "File is too large"),
  filename: z.string().max(255).optional(),
});

export const exportQuerySchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("csv"),
  reason: z.string().max(500).optional(),
});
