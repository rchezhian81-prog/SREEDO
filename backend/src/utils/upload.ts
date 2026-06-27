import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { env } from "../config/env";
import { ApiError } from "./api-error";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.storageMaxMb * 1024 * 1024, files: 1 },
});

/** multer single-file middleware that maps multer errors to ApiError (400). */
export function uploadSingle(field: string) {
  const mw = upload.single(field);
  return (req: Request, res: Response, next: NextFunction) =>
    mw(req, res, (err: unknown) => {
      if (err) {
        const code = (err as { code?: string }).code;
        if (code === "LIMIT_FILE_SIZE") {
          return next(ApiError.badRequest("File exceeds the size limit"));
        }
        return next(ApiError.badRequest(`Upload failed: ${(err as Error).message}`));
      }
      next();
    });
}
