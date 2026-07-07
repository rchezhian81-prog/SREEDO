// Super Admin Q — Help Center request validation (zod). Every query input is
// validated; unknown/oversized values are rejected before hitting the service.

import { z } from "zod";

const str = (max = 120) => z.string().trim().min(1).max(max);

export const helpListQuerySchema = z.object({
  q: str(200).optional(),
  module: str(60).optional(),
  category: str(60).optional(),
});

export const sopListQuerySchema = z.object({
  q: str(200).optional(),
  module: str(60).optional(),
});

export const checklistListQuerySchema = z.object({
  q: str(200).optional(),
  module: str(60).optional(),
});

export const limitationListQuerySchema = z.object({
  module: str(60).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["accepted", "planned", "fixed", "deferred", "future"]).optional(),
});

export const releaseListQuerySchema = z.object({
  module: str(60).optional(),
});

export const playbookListQuerySchema = z.object({
  q: str(200).optional(),
  module: str(60).optional(),
});

export const searchQuerySchema = z.object({
  q: str(200).optional(),
  type: z.enum(["help", "sop", "checklist", "playbook", "release", "limitation"]).optional(),
  module: str(60).optional(),
});

export const helpExportQuerySchema = z.object({
  kind: z.enum(["modules", "checklists", "limitations"]).default("modules"),
  format: z.enum(["csv", "json"]).default("csv"),
  reason: z.string().trim().max(500).optional(),
});

export type HelpExportQuery = z.infer<typeof helpExportQuerySchema>;
