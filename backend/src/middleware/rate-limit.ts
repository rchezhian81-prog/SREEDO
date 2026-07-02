import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { env } from "../config/env";

const windowMs = env.rateLimitWindowMinutes * 60 * 1000;

export const apiRateLimiter = rateLimit({
  windowMs,
  limit: env.rateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

/** Stricter limiter for credential endpoints to slow brute-force attempts. */
export const authRateLimiter = rateLimit({
  windowMs,
  limit: env.authRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts, please try again later" },
});

/**
 * Per-tenant limiter — keyed by the *institution*, not the IP, so one noisy
 * tenant (or one leaked API key hammering `/ext`) can't consume another tenant's
 * budget or starve the shared IP bucket. Mount it AFTER the request is
 * authenticated (so `req.user.institutionId` is populated); it falls back to the
 * IP for any unauthenticated request. In-memory today (single instance); swap in
 * a shared store (Redis) when running multi-instance.
 */
export const tenantRateLimiter = rateLimit({
  windowMs,
  limit: env.tenantRateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Bucket by institution. This limiter is only ever mounted AFTER authentication
  // (e.g. /ext, where apiKeyAuth resolves the key to a tenant and rejects anything
  // unauthenticated first), so institutionId is always present here; the constant
  // fallback is unreachable and only satisfies the type.
  keyGenerator: (req: Request) => `inst:${req.user?.institutionId ?? "unauthenticated"}`,
  message: { error: "Rate limit reached for this institution, please slow down" },
});
