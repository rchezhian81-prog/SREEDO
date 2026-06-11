import type { Request } from "express";
import { z } from "zod";
import { ApiError } from "./api-error";

/** Returns a route parameter as a plain string (Express 5 types allow arrays). */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw ApiError.badRequest(`Missing ${name} parameter`);
  }
  return value;
}

/** Returns a route parameter validated as a UUID. */
export function uuidParam(req: Request, name = "id"): string {
  const parsed = z.string().uuid().safeParse(req.params[name]);
  if (!parsed.success) {
    throw ApiError.badRequest(`Invalid ${name} parameter — expected a UUID`);
  }
  return parsed.data;
}
