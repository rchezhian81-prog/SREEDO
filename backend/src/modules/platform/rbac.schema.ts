import { z } from "zod";

// Super Admin H — RBAC governance. All inputs validated here; the service adds
// owner-safety, built-in protection, and high-risk reason rules.

const roleKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{2,48}$/, "Key must be 3-49 chars: lowercase letters, digits, underscores");
const reason = z.string().trim().min(5, "A reason of at least 5 characters is required").max(500);

export const listRolesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["active", "disabled", "archived"]).optional(),
  kind: z.enum(["built_in", "custom"]).optional(),
});

export const createRoleSchema = z.object({
  key: roleKey,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  copyFrom: roleKey.optional(), // seed permissions from an existing role/template
});

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export const archiveRoleSchema = z.object({ reason });

/** Save the full permission set for a role (matrix save). Reason required if the
 *  diff touches any high-risk permission. */
export const saveMatrixSchema = z.object({
  permissionKeys: z.array(z.string().min(1).max(120)).max(1000),
  reason: reason.optional(),
});

export const assignRoleSchema = z.object({
  roleKey,
  reason,
});

export const rbacAuditQuerySchema = z.object({
  action: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const exportQuerySchema = z.object({
  format: z.enum(["csv", "xlsx"]).default("csv"),
});
