import type { Request, Response } from "express";
import { Router } from "express";
import { uuidParam } from "../../utils/params";
import { authenticate, authorize } from "../../middleware/auth";
import { requirePermission } from "../../middleware/permissions";
import { toCsv, toXlsx, type Cell } from "../../utils/spreadsheet";
import {
  archiveSchema,
  createBackupSchema,
  downloadQuerySchema,
  drGuideUpdateSchema,
  exportQuerySchema,
  historyQuerySchema,
  listBackupsQuerySchema,
  restoreCancelSchema,
  restoreDecisionSchema,
  restoreExecuteSchema,
  restoreListQuerySchema,
  restoreRequestSchema,
  updateSettingsSchema,
} from "./backups.schema";
import * as service from "./backups.service";
import * as governance from "./backup-governance.service";
import * as restore from "./restore-requests.service";

// Backups sit ABOVE any tenant: super-admin only. authorize("super_admin") is the
// hard boundary; requirePermission documents/enforces the granular backup:* /
// restore:* model on top of it.
export const backupsRouter = Router();
backupsRouter.use(authenticate, authorize("super_admin"));

const actor = (req: Request) => ({
  id: req.user!.id,
  email: req.user!.email,
  role: req.user!.role,
  ip: req.ip ?? null,
});

const canRead = requirePermission("backup:read");
const canManage = requirePermission("backup:manage");
const canRestoreRead = requirePermission("restore:read");

/** Masked CSV/XLSX response for a curated column set (no storage paths/secrets). */
function sendSpreadsheet(
  res: Response,
  format: "csv" | "xlsx",
  filename: string,
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[]
): void {
  const headers = columns.map((c) => c.label);
  const data: Cell[][] = rows.map((r) => columns.map((c) => (r[c.key] ?? "") as Cell));
  if (format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
    res.send(toXlsx(headers, data));
  } else {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(toCsv(headers, data));
  }
}

const HISTORY_COLUMNS = [
  { key: "createdAt", label: "Created" },
  { key: "scope", label: "Scope" },
  { key: "trigger", label: "Trigger" },
  { key: "status", label: "Status" },
  { key: "sizeBytes", label: "Size (bytes)" },
  { key: "tableCount", label: "Tables" },
  { key: "rowCount", label: "Rows" },
  { key: "checksumStatus", label: "Checksum" },
  { key: "offsite", label: "Offsite" },
  { key: "createdBy", label: "Created by" },
  { key: "completedAt", label: "Completed" },
  { key: "error", label: "Error" },
];

// ---------------------------------------------------------------------------
// Dashboard + history (specific paths first — before the /:id catch-all).
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /backups/summary:
 *   get: { tags: [Backups], summary: "Backup dashboard cards (status/size/schedule/retention/integrity/offsite/encryption/restore/health warnings)", security: [{ bearerAuth: [] }], responses: { 200: { description: Summary } } }
 */
backupsRouter.get("/summary", canRead, async (_req, res) => {
  res.json(await service.summary());
});

/**
 * @openapi
 * /backups/history:
 *   get: { tags: [Backups], summary: "Paginated, filterable backup run history (date/status/scope/trigger/createdBy)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 */
backupsRouter.get("/history", canRead, async (req, res) => {
  res.json(await service.listBackupHistory(historyQuerySchema.parse(req.query)));
});

/**
 * @openapi
 * /backups/history/export:
 *   get: { tags: [Backups], summary: "Export backup history as masked CSV/XLSX (no storage paths). Audited.", security: [{ bearerAuth: [] }], responses: { 200: { description: "CSV or XLSX file" } } }
 */
backupsRouter.get("/history/export", requirePermission("backup:export"), async (req, res) => {
  const q = exportQuerySchema.parse(req.query);
  const rows = await service.backupHistoryExportRows({
    ...q,
    page: 1,
    pageSize: 50000,
    sort: "createdAt",
    order: "desc",
  });
  await service.recordAudit(actor(req), {
    action: "backup.history_exported",
    targetId: null,
    institutionId: null,
    detail: { format: q.format, count: rows.length, reason: q.reason ?? null },
  });
  sendSpreadsheet(res, q.format, "backup-history", HISTORY_COLUMNS, rows);
});

// ---------------------------------------------------------------------------
// Settings, offsite, encryption, DR guide.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /backups/settings:
 *   get: { tags: [Backups], summary: "Retention + schedule + offsite/encryption/alert settings", security: [{ bearerAuth: [] }], responses: { 200: { description: Settings } } }
 *   patch: { tags: [Backups], summary: "Update retention/schedule/offsite/encryption/alert settings (super admin)", security: [{ bearerAuth: [] }], responses: { 200: { description: Updated settings } } }
 */
backupsRouter.get("/settings", canRead, async (_req, res) => {
  res.json(await service.getSettings());
});
backupsRouter.patch("/settings", canManage, async (req, res) => {
  res.json(await service.updateSettings(updateSettingsSchema.parse(req.body), actor(req)));
});

/**
 * @openapi
 * /backups/offsite:
 *   get: { tags: [Backups], summary: "Offsite backup status (masked; never exposes keys)", security: [{ bearerAuth: [] }], responses: { 200: { description: Offsite status } } }
 */
backupsRouter.get("/offsite", canRead, async (_req, res) => {
  res.json(await governance.offsiteStatus());
});
/**
 * @openapi
 * /backups/offsite/test:
 *   post: { tags: [Backups], summary: "Test offsite storage connectivity (real probe; audited)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ ok, mode, detail }" } } }
 */
backupsRouter.post("/offsite/test", canManage, async (req, res) => {
  res.json(await governance.testOffsite(actor(req)));
});

/**
 * @openapi
 * /backups/encryption:
 *   get: { tags: [Backups], summary: "Backup encryption status (honest; documents the current limitation)", security: [{ bearerAuth: [] }], responses: { 200: { description: Encryption status } } }
 */
backupsRouter.get("/encryption", canRead, async (_req, res) => {
  res.json(await governance.encryptionStatus());
});

/**
 * @openapi
 * /backups/dr-guide:
 *   get: { tags: [Backups], summary: "In-app disaster-recovery guide", security: [{ bearerAuth: [] }], responses: { 200: { description: DR guide } } }
 *   patch: { tags: [Backups], summary: "Update the DR guide (plain text only; audited)", security: [{ bearerAuth: [] }], responses: { 200: { description: Updated guide } } }
 */
backupsRouter.get("/dr-guide", canRead, async (_req, res) => {
  res.json(await governance.getDrGuide());
});
backupsRouter.patch("/dr-guide", canManage, async (req, res) => {
  res.json(await governance.updateDrGuide(drGuideUpdateSchema.parse(req.body), actor(req)));
});

// ---------------------------------------------------------------------------
// Restore approval workflow (specific paths — before /:id).
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /backups/restore-requests:
 *   get: { tags: [Backups], summary: "List restore requests (approval workflow; paginated)", security: [{ bearerAuth: [] }], responses: { 200: { description: "{ rows, total, page, pageSize }" } } }
 */
backupsRouter.get("/restore-requests", canRestoreRead, async (req, res) => {
  res.json(await restore.listRestoreRequests(restoreListQuerySchema.parse(req.query)));
});
/**
 * @openapi
 * /backups/restore-requests/{id}:
 *   get: { tags: [Backups], summary: "Get one restore request (with impact preview + confirm phrase)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Restore request } } }
 */
backupsRouter.get("/restore-requests/:id", canRestoreRead, async (req, res) => {
  res.json(await restore.getRestoreRequest(uuidParam(req)));
});
/**
 * @openapi
 * /backups/restore-requests/{id}/decide:
 *   post: { tags: [Backups], summary: "Approve or reject a restore request (reason required; self-approval blocked; audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Decided request }, 403: { description: Self-approval blocked } } }
 */
backupsRouter.post("/restore-requests/:id/decide", requirePermission("restore:approve"), async (req, res) => {
  res.json(await restore.decideRestore(uuidParam(req), restoreDecisionSchema.parse(req.body), actor(req)));
});
/**
 * @openapi
 * /backups/restore-requests/{id}/cancel:
 *   post: { tags: [Backups], summary: "Cancel a pending/approved restore request (reason required; audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Cancelled request } } }
 */
backupsRouter.post("/restore-requests/:id/cancel", requirePermission("restore:request"), async (req, res) => {
  res.json(await restore.cancelRestore(uuidParam(req), restoreCancelSchema.parse(req.body), actor(req)));
});
/**
 * @openapi
 * /backups/restore-requests/{id}/execute:
 *   post: { tags: [Backups], summary: "Execute an APPROVED restore (typed confirmation + reason; takes a pre-restore backup, validates checksum; destructive; production needs force). Single-use.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Executed }, 400: { description: Confirmation phrase / not approved }, 409: { description: Approval already used } } }
 */
backupsRouter.post("/restore-requests/:id/execute", requirePermission("restore:execute"), async (req, res) => {
  res.json(await restore.executeRestore(uuidParam(req), restoreExecuteSchema.parse(req.body), actor(req)));
});

// ---------------------------------------------------------------------------
// Backup list/create + per-backup actions.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /backups:
 *   get: { tags: [Backups], summary: "List backups (metadata only; never exposes storage paths)", security: [{ bearerAuth: [] }], responses: { 200: { description: Backups } } }
 *   post: { tags: [Backups], summary: "Trigger a manual backup now (super admin)", security: [{ bearerAuth: [] }], responses: { 201: { description: Created backup metadata } } }
 */
backupsRouter.get("/", canRead, async (req, res) => {
  res.json(await service.listBackups(listBackupsQuerySchema.parse(req.query)));
});
backupsRouter.post("/", requirePermission("backup:create"), async (req, res) => {
  res.status(201).json(await service.createBackup(createBackupSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /backups/{id}:
 *   get: { tags: [Backups], summary: "Get one backup's metadata", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Backup }, 404: { description: Not found } } }
 *   delete: { tags: [Backups], summary: "Archive a backup (soft; metadata retained). Reason required via body; latest/rollback-window need override.", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Archived } } }
 */
backupsRouter.get("/:id", canRead, async (req, res) => {
  res.json(await service.getBackup(uuidParam(req)));
});
backupsRouter.delete("/:id", requirePermission("backup:archive"), async (req, res) => {
  res.json(await service.archiveBackup(uuidParam(req), archiveSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /backups/{id}/archive:
 *   post: { tags: [Backups], summary: "Archive a backup artifact (soft-delete; metadata retained; reason required)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Archived }, 400: { description: "Latest/rollback-window needs override" } } }
 */
backupsRouter.post("/:id/archive", requirePermission("backup:archive"), async (req, res) => {
  res.json(await service.archiveBackup(uuidParam(req), archiveSchema.parse(req.body ?? {}), actor(req)));
});

/**
 * @openapi
 * /backups/{id}/verify:
 *   post: { tags: [Backups], summary: "Verify a backup checksum by re-reading + rehashing the artifact (audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: "{ verified, checksumStatus, detail }" } } }
 */
backupsRouter.post("/:id/verify", requirePermission("backup:verify"), async (req, res) => {
  res.json(await service.verifyBackupChecksum(uuidParam(req), actor(req)));
});

/**
 * @openapi
 * /backups/{id}/download:
 *   get: { tags: [Backups], summary: "Download a backup artifact (reason required; audited high-risk)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }, { in: query, name: reason, required: true, schema: { type: string, minLength: 5 } }], responses: { 200: { description: The gzipped backup bytes }, 400: { description: Reason required / no artifact } } }
 */
backupsRouter.get("/:id/download", requirePermission("backup:download"), async (req, res) => {
  const { reason } = downloadQuerySchema.parse(req.query);
  const { buffer, filename } = await service.downloadBackup(uuidParam(req), reason, actor(req));
  res
    .type("application/gzip")
    .set("Content-Disposition", `attachment; filename="${filename}"`)
    .send(buffer);
});

/**
 * @openapi
 * /backups/{id}/restore/preview:
 *   get: { tags: [Backups], summary: "Preview what a restore would load (non-destructive/read-only)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Restore preview } } }
 */
backupsRouter.get("/:id/restore/preview", canRestoreRead, async (req, res) => {
  res.json(await service.restorePreview(uuidParam(req)));
});

/**
 * @openapi
 * /backups/{id}/test-restore:
 *   post: { tags: [Backups], summary: "Dry-run restore verification (decodes + checksum + schema check; does NOT modify data; audited)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 200: { description: Dry-run report } } }
 */
backupsRouter.post("/:id/test-restore", canRestoreRead, async (req, res) => {
  res.json(await restore.testRestore(uuidParam(req), actor(req)));
});

/**
 * @openapi
 * /backups/{id}/restore-requests:
 *   post: { tags: [Backups], summary: "Raise a restore request for this backup (starts approval workflow; reason required)", security: [{ bearerAuth: [] }], parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }], responses: { 201: { description: Restore request }, 400: { description: Non-restorable backup } } }
 */
backupsRouter.post("/:id/restore-requests", requirePermission("restore:request"), async (req, res) => {
  res.status(201).json(await restore.requestRestore(uuidParam(req), restoreRequestSchema.parse(req.body ?? {}), actor(req)));
});
