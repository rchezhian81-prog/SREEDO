import { z } from "zod";

// PR-T2 — Tenant RBAC v2 request schemas.

// The full desired set of registry permission keys the role should end up with
// (the checked boxes in the matrix). The service diffs this against the global
// defaults and stores the delta. A reason is required for high-risk changes.
export const updateRoleSchema = z.object({
  permissions: z.array(z.string().min(1).max(120)).max(1000),
  reason: z.string().max(1000).optional(),
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
