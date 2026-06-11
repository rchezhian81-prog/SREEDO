import rateLimit from "express-rate-limit";
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
