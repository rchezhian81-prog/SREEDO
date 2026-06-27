import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { subscriptionStatus } from "./billing.service";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * PLACEHOLDER subscription-status enforcement (Billing Phase B1).
 *
 * Intentionally NOT mounted on any route yet, and a no-op unless
 * `BILLING_ENFORCE_SUBSCRIPTION=true`. When a future phase is ready to enforce,
 * mount it AFTER `requireTenant`. The design:
 *  - reads (GET/HEAD/OPTIONS) are always allowed, so a lapsed tenant can still
 *    view and export its own data (data portability),
 *  - state-changing requests are blocked with 402 when the subscription has
 *    expired / lapsed (past grace) or the institution is suspended,
 *  - super_admin and tenant-less principals pass through.
 *
 * It NEVER deletes data and is fully reversible (renewing flips `isActiveNow`).
 */
export async function requireActiveSubscription(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!env.billingEnforceSubscription) return next();
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.user?.role === "super_admin") return next();
    const institutionId = req.user?.institutionId;
    if (!institutionId) return next();

    const status = await subscriptionStatus(institutionId);
    // No subscription on record = not yet onboarded to billing; don't block.
    if (status && !status.isActiveNow) {
      throw new ApiError(
        402,
        "Subscription inactive — please renew to continue making changes"
      );
    }
    next();
  } catch (err) {
    next(err as Error);
  }
}
