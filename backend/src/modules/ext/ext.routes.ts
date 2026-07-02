import { Router } from "express";
import { query } from "../../db/postgres";
import { tenantRateLimiter } from "../../middleware/rate-limit";
import { apiKeyAuth } from "./ext.auth";

// External, read-only API authenticated by an institution API key (x-api-key),
// scoped to that key's tenant. Deliberately read-only and on its own surface, so
// a leaked key can never mutate or destroy data — only read the tenant it owns.
export const extRouter = Router();
// Authenticate first (resolves the key → institution), then apply a per-tenant
// rate limit keyed by that institution so one key can't starve others.
extRouter.use(apiKeyAuth, tenantRateLimiter);

/**
 * @openapi
 * /ext/me:
 *   get:
 *     tags: [External API]
 *     summary: The institution this API key belongs to (use it to verify a key works)
 *     security: [{ apiKeyAuth: [] }]
 *     responses:
 *       200: { description: "{ institution: { id, name, code, type } }" }
 *       401: { description: Missing or invalid API key }
 */
extRouter.get("/me", async (req, res) => {
  const { rows } = await query(
    "SELECT id, name, code, type FROM institutions WHERE id = $1",
    [req.user!.institutionId]
  );
  res.json({ institution: rows[0] ?? null });
});

/**
 * @openapi
 * /ext/students:
 *   get:
 *     tags: [External API]
 *     summary: Active students in this API key's institution (read-only, max 200)
 *     security: [{ apiKeyAuth: [] }]
 *     responses:
 *       200: { description: Student list }
 *       401: { description: Missing or invalid API key }
 */
extRouter.get("/students", async (req, res) => {
  const { rows } = await query(
    `SELECT id, admission_no AS "admissionNo", first_name AS "firstName",
            last_name AS "lastName", status
     FROM students
     WHERE institution_id = $1 AND status <> 'archived'
     ORDER BY created_at DESC LIMIT 200`,
    [req.user!.institutionId]
  );
  res.json(rows);
});
