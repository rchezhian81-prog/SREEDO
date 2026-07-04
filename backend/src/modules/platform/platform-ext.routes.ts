import { Router } from "express";
import { query } from "../../db/postgres";
import { authenticatePlatformToken } from "../../middleware/platform-token";
import { platformKpis } from "./platform.service";

/**
 * Super Admin P — Phase 2: governed, READ-ONLY external surface.
 *
 * Authenticated by a scoped platform API token (`X-Platform-Token`), NOT a JWT —
 * so a leaked token can only READ the specific, non-sensitive slices its scopes
 * allow, never mutate anything and never see secrets. Each route requires an
 * explicit scope from the fixed governed set. Deliberately tiny: it reuses the
 * existing platform reads (same stores, curated projections), returns no secrets
 * or token values, and is mounted BEFORE the JWT-guarded platform router so its
 * token auth is reached instead of `authenticate`.
 */
export const platformExtRouter = Router();

/**
 * @openapi
 * /platform/ext/summary:
 *   get:
 *     tags: [Platform External API]
 *     summary: "Non-sensitive platform overview (institution/user/subscription counts + module adoption)"
 *     description: "Requires an X-Platform-Token with the platform:read scope. Read-only; no secrets."
 *     responses:
 *       200: { description: "{ totalInstitutions, activeInstitutions, suspendedInstitutions, activeSubscriptions, totalUsers, moduleAdoption, generatedAt }" }
 *       401: { description: Missing/invalid/expired/revoked token }
 *       403: { description: Token lacks the platform:read scope }
 */
platformExtRouter.get(
  "/summary",
  authenticatePlatformToken("platform:read"),
  async (_req, res) => {
    // platformKpis() spreads a Record into its result, so index its fields via a
    // record view. Curated, non-sensitive subset (omit money totals + storage).
    const kpis = (await platformKpis()) as Record<string, unknown>;
    res.json({
      totalInstitutions: kpis.totalInstitutions,
      activeInstitutions: kpis.activeInstitutions,
      suspendedInstitutions: kpis.suspendedInstitutions,
      activeSubscriptions: kpis.activeSubscriptions,
      totalUsers: kpis.totalUsers,
      moduleAdoption: kpis.moduleAdoption,
      generatedAt: new Date().toISOString(),
    });
  }
);

/**
 * @openapi
 * /platform/ext/audit:
 *   get:
 *     tags: [Platform External API]
 *     summary: "Recent platform audit activity (curated, non-sensitive columns)"
 *     description: "Requires an X-Platform-Token with the audit:read scope. Read-only; returns only action/actor/target/time — never secrets or request detail."
 *     responses:
 *       200: { description: "{ rows: [{ id, action, actorEmail, actorRole, targetType, createdAt }] }" }
 *       401: { description: Missing/invalid/expired/revoked token }
 *       403: { description: Token lacks the audit:read scope }
 */
platformExtRouter.get(
  "/audit",
  authenticatePlatformToken("audit:read"),
  async (_req, res) => {
    // Same durable store as the Security Center, curated projection, capped.
    const { rows } = await query(
      `SELECT id, action, actor_email AS "actorEmail", actor_role AS "actorRole",
              target_type AS "targetType", created_at AS "createdAt"
       FROM platform_audit_log
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json({ rows });
  }
);
