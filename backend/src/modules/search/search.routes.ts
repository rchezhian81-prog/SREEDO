import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { requireTenant, tenantId } from "../../middleware/tenant";
import { requireStaff } from "../../utils/scope";
import { query } from "../../db/postgres";
import { effectivePermissions } from "../../middleware/permissions";

export const searchRouter = Router();

// Lightweight tenant global search (PR-T4). Staff-only, tenant-scoped, and
// permission-gated per entity — students are only searched for students:read
// holders. Every hit routes to a real module page. Results are capped so this
// stays cheap; it is NOT a full search engine.
const querySchema = z.object({ q: z.string().trim().min(2).max(100) });

type Hit = { type: string; id: string; label: string; sub: string | null; href: string };

/**
 * @openapi
 * /search:
 *   get:
 *     tags: [Search]
 *     summary: Lightweight tenant search across students, staff and academic structure (staff-only, RBAC-gated)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, required: true, schema: { type: string, minLength: 2 } }
 *     responses:
 *       200: { description: Grouped result hits, each routing to a module page }
 */
searchRouter.get("/", authenticate, requireTenant, async (req, res) => {
  requireStaff(req);
  const inst = tenantId(req);
  const { q } = querySchema.parse(req.query);
  const like = `%${q}%`;
  const perms = new Set(await effectivePermissions(req.user!));
  const has = (k: string) => perms.has(k);
  const hits: Hit[] = [];

  // Students carry PII — only for students:read holders.
  if (has("students:read")) {
    const { rows } = await query<{
      id: string;
      first_name: string;
      last_name: string;
      admission_no: string | null;
    }>(
      `SELECT id, first_name, last_name, admission_no FROM students
       WHERE institution_id = $1 AND status = 'active'
         AND (first_name ILIKE $2 OR last_name ILIKE $2 OR admission_no ILIKE $2
              OR (first_name || ' ' || last_name) ILIKE $2)
       ORDER BY first_name, last_name LIMIT 5`,
      [inst, like]
    );
    for (const r of rows)
      hits.push({
        type: "student",
        id: r.id,
        label: `${r.first_name} ${r.last_name}`,
        sub: r.admission_no,
        href: "/students",
      });
  }

  // Staff directory, academic structure — visible to any staff (matches the
  // existing list endpoints, which are staff-gated without a finer permission).
  const { rows: staff } = await query<{
    id: string;
    first_name: string;
    last_name: string;
    employee_no: string | null;
  }>(
    `SELECT id, first_name, last_name, employee_no FROM teachers
     WHERE institution_id = $1 AND is_active = true
       AND (first_name ILIKE $2 OR last_name ILIKE $2 OR employee_no ILIKE $2
            OR (first_name || ' ' || last_name) ILIKE $2)
     ORDER BY first_name, last_name LIMIT 5`,
    [inst, like]
  );
  for (const r of staff)
    hits.push({
      type: "staff",
      id: r.id,
      label: `${r.first_name} ${r.last_name}`,
      sub: r.employee_no,
      href: "/teachers",
    });

  const { rows: classes } = await query<{ id: string; name: string }>(
    `SELECT id, name FROM classes WHERE institution_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 5`,
    [inst, like]
  );
  for (const r of classes)
    hits.push({ type: "class", id: r.id, label: r.name, sub: null, href: "/classes" });

  // College programs (present only for college tenants).
  const { rows: programs } = await query<{ id: string; name: string; code: string }>(
    `SELECT id, name, code FROM programs WHERE institution_id = $1 AND (name ILIKE $2 OR code ILIKE $2) ORDER BY name LIMIT 5`,
    [inst, like]
  );
  for (const r of programs)
    hits.push({ type: "program", id: r.id, label: r.name, sub: r.code, href: "/college/programs" });

  res.json({ query: q, results: hits });
});
