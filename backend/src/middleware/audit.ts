import type { NextFunction, Request, Response } from "express";
import { getMongoDb } from "../db/mongo";

/**
 * Best-effort audit trail of every mutating API call, written to MongoDB.
 * Skipped silently when MongoDB is not connected.
 */
export function auditLog(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") {
    next();
    return;
  }

  res.on("finish", () => {
    const db = getMongoDb();
    if (!db) return;
    // Derive a coarse module from the path segment after the API prefix
    // (e.g. /api/v1/payroll/runs -> "payroll") for audit-log filtering.
    const cleanPath = req.originalUrl.split("?")[0];
    const segs = cleanPath.split("/").filter(Boolean);
    const apiIdx = segs.indexOf("v1");
    const module = (apiIdx >= 0 ? segs[apiIdx + 1] : segs[0]) ?? null;
    db.collection("audit_logs")
      .insertOne({
        method: req.method,
        path: cleanPath,
        module,
        statusCode: res.statusCode,
        userId: req.user?.id ?? null,
        userRole: req.user?.role ?? null,
        institutionId: req.user?.institutionId ?? null,
        ip: req.ip,
        createdAt: new Date(),
      })
      .catch(() => undefined);
  });

  next();
}
