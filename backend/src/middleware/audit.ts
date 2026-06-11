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
    db.collection("audit_logs")
      .insertOne({
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        userId: req.user?.id ?? null,
        userRole: req.user?.role ?? null,
        ip: req.ip,
        createdAt: new Date(),
      })
      .catch(() => undefined);
  });

  next();
}
