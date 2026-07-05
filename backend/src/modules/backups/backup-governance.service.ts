import type { z } from "zod";
import { query } from "../../db/postgres";
import { env } from "../../config/env";
import { storage, storageMode, storageConfigured } from "../../utils/storage";
import { recordAudit, getSettings, type Actor } from "./backups.service";
import type { drGuideUpdateSchema } from "./backups.schema";

/** Safe host of the configured S3 endpoint (never the keys/credentials). */
function offsiteHost(): string | null {
  if (!env.storageEndpoint) return null;
  try {
    return new URL(env.storageEndpoint).host;
  } catch {
    return env.storageEndpoint.replace(/^https?:\/\//, "").split("/")[0] || null;
  }
}

/**
 * Offsite (object-storage) backup status. Offsite = the configured S3-compatible
 * backend; when it is not configured, backups live on the app-server disk only.
 * Only masked/safe values are ever returned — endpoint HOST + bucket name, never
 * access keys, secret keys or storage passwords.
 */
export async function offsiteStatus() {
  const settings = (await getSettings()) as {
    offsiteEnabled: boolean;
    lastOffsiteTestAt: string | null;
    lastOffsiteTestOk: boolean | null;
    lastOffsiteTestDetail: string | null;
  };
  const configured = storageConfigured();
  const syncStatus = !configured ? "not_configured" : settings.lastOffsiteTestOk === false ? "failed" : "synced";
  return {
    mode: storageMode, // 's3' | 'local'
    target: configured ? "s3" : "local_disk",
    configured,
    // Masked/safe values only.
    endpointHost: offsiteHost(),
    bucket: configured ? env.storageBucket : null,
    syncStatus,
    lastTestAt: settings.lastOffsiteTestAt,
    lastTestOk: settings.lastOffsiteTestOk,
    lastTestDetail: settings.lastOffsiteTestDetail,
    // Honest limitation when only local disk is available.
    note: configured
      ? "Backups are copied to S3-compatible object storage."
      : "Offsite storage is not configured — configure STORAGE_* env to enable S3 offsite copies. Backups currently live on the application server disk only.",
  };
}

/** Live connectivity test of the offsite store (real probe; never exposes secrets). */
export async function testOffsite(actor: Actor) {
  const result = await storage.ping();
  await query(
    `UPDATE backup_settings
       SET last_offsite_test_at = now(), last_offsite_test_ok = $1, last_offsite_test_detail = $2
     WHERE id = 1`,
    [result.ok, result.detail.slice(0, 500)]
  );
  await recordAudit(actor, {
    action: "backup.offsite_test",
    targetId: null,
    institutionId: null,
    detail: { mode: storageMode, ok: result.ok, detail: result.detail },
  });
  return { ok: result.ok, mode: storageMode, detail: result.detail };
}

/**
 * Backup encryption status. HONEST: application-level backup encryption is not
 * implemented — artifacts rely on the storage provider's at-rest encryption (if
 * any). Surfaced clearly with a warning and documented as a future hardening; we
 * never claim encryption that is not actually happening.
 */
export async function encryptionStatus() {
  const settings = (await getSettings()) as { encryptionEnabled: boolean };
  return {
    implemented: false,
    status: "not_enabled" as const,
    algorithm: null,
    keyManagement: "not_configured" as const,
    atRestAcknowledged: Boolean(settings.encryptionEnabled),
    warning:
      "Application-level backup encryption is NOT implemented. Backup artifacts are gzip-compressed but not encrypted by the application; they rely on the storage provider's at-rest encryption if configured. This is a documented future hardening.",
  };
}

const DR_SELECT = `
  policy_summary AS "policySummary", restore_process AS "restoreProcess",
  approval_process AS "approvalProcess", emergency_instructions AS "emergencyInstructions",
  pre_restore_checklist AS "preRestoreChecklist", post_restore_checklist AS "postRestoreChecklist",
  rollback_guide AS "rollbackGuide", owner_name AS "ownerName", owner_contact AS "ownerContact",
  sop_link AS "sopLink", last_reviewed_at AS "lastReviewedAt", updated_at AS "updatedAt"`;

export async function getDrGuide() {
  await query("INSERT INTO backup_dr_guide (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  const { rows } = await query(`SELECT ${DR_SELECT} FROM backup_dr_guide WHERE id = 1`);
  return rows[0];
}

/** Update the in-app DR guide (plain operational text only — never secrets/keys). */
export async function updateDrGuide(input: z.infer<typeof drGuideUpdateSchema>, actor: Actor) {
  const map: Record<string, string> = {
    policySummary: "policy_summary",
    restoreProcess: "restore_process",
    approvalProcess: "approval_process",
    emergencyInstructions: "emergency_instructions",
    preRestoreChecklist: "pre_restore_checklist",
    postRestoreChecklist: "post_restore_checklist",
    rollbackGuide: "rollback_guide",
    ownerName: "owner_name",
    ownerContact: "owner_contact",
    sopLink: "sop_link",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(map)) {
    if ((input as Record<string, unknown>)[field] !== undefined) {
      params.push((input as Record<string, unknown>)[field] === "" ? null : (input as Record<string, unknown>)[field]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (input.markReviewed) {
    params.push(actor.id);
    sets.push(`last_reviewed_at = now(), last_reviewed_by = $${params.length}`);
  }
  params.push(actor.id);
  sets.push(`updated_by = $${params.length}`);

  if (sets.length > 1) {
    await query(
      `INSERT INTO backup_dr_guide (id) VALUES (1) ON CONFLICT (id) DO NOTHING`
    );
    await query(`UPDATE backup_dr_guide SET ${sets.join(", ")} WHERE id = 1`, params);
  }
  await recordAudit(actor, {
    action: "backup.dr_guide_update",
    targetId: null,
    institutionId: null,
    detail: { fields: Object.keys(input).filter((k) => k !== "markReviewed"), reviewed: Boolean(input.markReviewed) },
  });
  return getDrGuide();
}
