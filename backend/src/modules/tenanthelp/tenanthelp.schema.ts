// PR-T10 — Tenant Help/SOP request validation (zod). Read-only module: only
// query inputs exist; oversized/unknown values are rejected before the service.

import { z } from "zod";

const str = (max = 200) => z.string().trim().min(1).max(max);

export const helpListQuerySchema = z.object({
  q: str().optional(),
  category: str(60).optional(),
});

export const helpSearchQuerySchema = z.object({
  q: str().optional(),
  type: z.enum(["article", "sop", "getting-started"]).optional(),
});
