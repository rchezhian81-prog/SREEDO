import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { env } from "../../config/env";
import { mailerConfigured } from "../../utils/mailer";
import { recordAudit, type Actor } from "./platform.service";
import type {
  FeatureFlagCreateInput,
  FeatureFlagUpdateInput,
  UpdatePlatformSettingsInput,
} from "./platform-settings.schema";

/**
 * Global Platform Settings + Feature-flag governance (Super Admin N).
 *
 * Platform-GLOBAL configuration only — tenant-specific settings stay on the
 * Tenant module (institutions.settings). No secret is ever read from or written
 * to these tables. Every change is audited via platform_audit_log (target_type
 * 'platform_settings' / 'feature_flag'); the before/after diff lives in
 * audit.detail.diff so the settings-history view can render it and a safe
 * rollback can re-apply prior values.
 */

const SETTINGS_COLS = `
  platform_name AS "platformName", platform_display_name AS "platformDisplayName",
  support_email AS "supportEmail", support_phone AS "supportPhone",
  default_country AS "defaultCountry", default_state AS "defaultState",
  default_timezone AS "defaultTimezone", default_currency AS "defaultCurrency",
  default_language AS "defaultLanguage", academic_year_format AS "academicYearFormat",
  date_format AS "dateFormat", time_format AS "timeFormat",
  financial_year_start_month AS "financialYearStartMonth", internal_notes AS "internalNotes",
  maintenance_mode AS "maintenanceMode", maintenance_message AS "maintenanceMessage",
  maintenance_starts_at AS "maintenanceStartsAt", maintenance_ends_at AS "maintenanceEndsAt",
  announcement_active AS "announcementActive", announcement_text AS "announcementText",
  announcement_visibility AS "announcementVisibility",
  updated_at AS "updatedAt", updated_by AS "updatedBy"`;

const SETTINGS_COLUMN_MAP: Record<string, string> = {
  platformName: "platform_name",
  platformDisplayName: "platform_display_name",
  supportEmail: "support_email",
  supportPhone: "support_phone",
  defaultCountry: "default_country",
  defaultState: "default_state",
  defaultTimezone: "default_timezone",
  defaultCurrency: "default_currency",
  defaultLanguage: "default_language",
  academicYearFormat: "academic_year_format",
  dateFormat: "date_format",
  timeFormat: "time_format",
  financialYearStartMonth: "financial_year_start_month",
  internalNotes: "internal_notes",
  maintenanceMode: "maintenance_mode",
  maintenanceMessage: "maintenance_message",
  maintenanceStartsAt: "maintenance_starts_at",
  maintenanceEndsAt: "maintenance_ends_at",
  announcementActive: "announcement_active",
  announcementText: "announcement_text",
  announcementVisibility: "announcement_visibility",
};

export interface PlatformSettings {
  platformName: string;
  platformDisplayName: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  defaultCountry: string | null;
  defaultState: string | null;
  defaultTimezone: string;
  defaultCurrency: string;
  defaultLanguage: string;
  academicYearFormat: string;
  dateFormat: string;
  timeFormat: string;
  financialYearStartMonth: number;
  internalNotes: string | null;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  maintenanceStartsAt: string | null;
  maintenanceEndsAt: string | null;
  announcementActive: boolean;
  announcementText: string | null;
  announcementVisibility: "super_admin" | "tenant_admins" | "all_users";
  updatedAt: string;
  updatedBy: string | null;
}

export async function getSettings(): Promise<PlatformSettings> {
  const { rows } = await query<PlatformSettings>(
    `SELECT ${SETTINGS_COLS} FROM platform_settings WHERE id = TRUE`
  );
  if (rows[0]) return rows[0];
  // Self-heal: the singleton can disappear if `users` is truncated in tests
  // (the updated_by FK cascades to SET NULL, but be defensive) — re-seed it.
  await query(`INSERT INTO platform_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING`);
  const retry = await query<PlatformSettings>(
    `SELECT ${SETTINGS_COLS} FROM platform_settings WHERE id = TRUE`
  );
  return retry.rows[0];
}

const norm = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);

function diffOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[]
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    const a = norm(before[k]);
    const b = norm(after[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) diff[k] = { from: a, to: b };
  }
  return diff;
}

function assertValidDate(value: unknown, label: string): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw ApiError.badRequest(`${label} must be a valid date/time`);
  }
}

export async function updateSettings(
  input: UpdatePlatformSettingsInput,
  actor: Actor
): Promise<PlatformSettings> {
  const data = input as Record<string, unknown>;
  assertValidDate(data.maintenanceStartsAt, "Maintenance start");
  assertValidDate(data.maintenanceEndsAt, "Maintenance end");

  const before = (await getSettings()) as unknown as Record<string, unknown>;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(SETTINGS_COLUMN_MAP)) {
    if (field in data) {
      params.push(data[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length) {
    params.push(actor.id);
    sets.push(`updated_at = now()`, `updated_by = $${params.length}`);
    await query(`UPDATE platform_settings SET ${sets.join(", ")} WHERE id = TRUE`, params);
  }
  const after = (await getSettings()) as unknown as Record<string, unknown>;
  const diff = diffOf(before, after, Object.keys(SETTINGS_COLUMN_MAP).filter((k) => k in data));
  if (Object.keys(diff).length) {
    await recordAudit(actor, {
      action: "platform.settings_update",
      targetType: "platform_settings",
      targetId: null,
      institutionId: null,
      detail: { fields: Object.keys(diff), diff },
    });
  }
  return after as unknown as PlatformSettings;
}

/**
 * Safe, allow-listed platform info + integration status. NEVER spreads `env`;
 * only the explicitly listed non-secret values and boolean "configured" flags
 * are returned. Secrets (DB url, JWT secrets, SMTP password, API/storage keys,
 * webhook secret) are never referenced here.
 */
export function platformInfo() {
  return {
    environment: env.nodeEnv,
    appUrl: env.appPublicUrl ?? env.corsOrigin[0] ?? null,
    apiDocsEnabled: env.enableApiDocs,
    email: { configured: mailerConfigured(), from: env.smtpFrom },
    storage: {
      configured: Boolean(env.storageBucket),
      mode: env.storageBucket ? "s3" : "local",
      region: env.storageRegion,
      maxMb: env.storageMaxMb,
    },
    sms: {
      configured: Boolean(env.smsProvider && env.smsApiKey),
      provider: env.smsProvider ?? null,
      sender: env.smsSender,
    },
    push: { configured: Boolean(env.fcmServerKey) },
    ai: { configured: Boolean(env.openaiApiKey), model: env.openaiModel },
    payments: {
      configured: Boolean(env.paymentGatewayProvider && env.paymentGatewayWebhookSecret),
      provider: env.paymentGatewayProvider ?? null,
      currency: env.paymentCurrency,
    },
    security: {
      maxFailedAttempts: env.authMaxFailedAttempts,
      lockoutMinutes: env.authLockoutMinutes,
      accessTokenTtl: env.jwtAccessTtl,
      refreshTokenTtlDays: env.jwtRefreshTtlDays,
      passwordResetTtlMinutes: env.passwordResetTtlMinutes,
      rateLimitWindowMinutes: env.rateLimitWindowMinutes,
      rateLimitMax: env.rateLimitMax,
    },
    billing: {
      graceDays: env.billingGraceDays,
      reminderDays: env.billingReminderDays,
      autoSuspend: env.billingAutoSuspend,
      enforceSubscription: env.billingEnforceSubscription,
    },
    company: {
      name: env.saasCompanyName,
      email: env.saasCompanyEmail ?? null,
      gstinConfigured: Boolean(env.saasCompanyGstin),
    },
  };
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

const FLAG_COLS = `
  f.id, f.key, f.display_name AS "displayName", f.description,
  f.default_value AS "defaultValue", f.status, f.scope,
  f.rollout_percentage AS "rolloutPercentage", f.allowed_tenants AS "allowedTenants",
  f.created_by AS "createdBy", cb.email AS "createdByEmail",
  f.updated_by AS "updatedBy", ub.email AS "updatedByEmail",
  f.created_at AS "createdAt", f.updated_at AS "updatedAt"`;

const FLAG_FROM = `
  FROM platform_feature_flags f
  LEFT JOIN users cb ON cb.id = f.created_by
  LEFT JOIN users ub ON ub.id = f.updated_by`;

export interface FeatureFlag {
  id: string;
  key: string;
  displayName: string;
  description: string | null;
  defaultValue: boolean;
  status: "enabled" | "disabled" | "rollout";
  scope: "global" | "tenant" | "package";
  rolloutPercentage: number | null;
  allowedTenants: string[];
  createdBy: string | null;
  createdByEmail: string | null;
  updatedBy: string | null;
  updatedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listFeatureFlags(): Promise<FeatureFlag[]> {
  const { rows } = await query<FeatureFlag>(
    `SELECT ${FLAG_COLS} ${FLAG_FROM} ORDER BY f.created_at DESC`
  );
  return rows;
}

async function getFlagOrThrow(id: string): Promise<FeatureFlag> {
  const { rows } = await query<FeatureFlag>(
    `SELECT ${FLAG_COLS} ${FLAG_FROM} WHERE f.id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Feature flag not found");
  return rows[0];
}

export async function createFeatureFlag(
  input: FeatureFlagCreateInput,
  actor: Actor
): Promise<FeatureFlag> {
  const dup = await query(`SELECT 1 FROM platform_feature_flags WHERE key = $1`, [input.key]);
  if (dup.rows.length) throw ApiError.conflict("A feature flag with this key already exists");
  const { rows } = await query<{ id: string }>(
    `INSERT INTO platform_feature_flags
       (key, display_name, description, default_value, status, scope, rollout_percentage, allowed_tenants, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     RETURNING id`,
    [
      input.key,
      input.displayName,
      input.description ?? null,
      input.defaultValue ?? false,
      input.status ?? "disabled",
      input.scope ?? "global",
      input.rolloutPercentage ?? null,
      input.allowedTenants ?? [],
      actor.id,
    ]
  );
  const flag = await getFlagOrThrow(rows[0].id);
  await recordAudit(actor, {
    action: "platform.feature_flag_create",
    targetType: "feature_flag",
    targetId: flag.id,
    institutionId: null,
    detail: { key: flag.key, displayName: flag.displayName, status: flag.status, scope: flag.scope },
  });
  return flag;
}

const FLAG_COLUMN_MAP: Record<string, string> = {
  displayName: "display_name",
  description: "description",
  defaultValue: "default_value",
  status: "status",
  scope: "scope",
  rolloutPercentage: "rollout_percentage",
  allowedTenants: "allowed_tenants",
};

export async function updateFeatureFlag(
  id: string,
  input: FeatureFlagUpdateInput,
  actor: Actor
): Promise<FeatureFlag> {
  const before = (await getFlagOrThrow(id)) as unknown as Record<string, unknown>;
  const data = input as Record<string, unknown>;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [field, col] of Object.entries(FLAG_COLUMN_MAP)) {
    if (field in data) {
      params.push(data[field]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length) {
    params.push(actor.id);
    sets.push(`updated_at = now()`, `updated_by = $${params.length}`);
    params.push(id);
    await query(
      `UPDATE platform_feature_flags SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params
    );
  }
  const after = (await getFlagOrThrow(id)) as unknown as Record<string, unknown>;
  const diff = diffOf(before, after, Object.keys(FLAG_COLUMN_MAP).filter((k) => k in data));
  // Only audit a real change (keeps the settings-history trail clean — matches
  // updateSettings / rollbackSettings).
  if (Object.keys(diff).length) {
    await recordAudit(actor, {
      action: "platform.feature_flag_update",
      targetType: "feature_flag",
      targetId: id,
      institutionId: null,
      detail: { key: after.key, fields: Object.keys(diff), diff },
    });
  }
  return after as unknown as FeatureFlag;
}

export async function setFeatureFlagStatus(
  id: string,
  status: "enabled" | "disabled" | "rollout",
  rolloutPercentage: number | null | undefined,
  reason: string | undefined,
  actor: Actor
): Promise<FeatureFlag> {
  const before = await getFlagOrThrow(id);
  const pct = status === "rollout" ? rolloutPercentage ?? before.rolloutPercentage ?? 0 : null;
  await query(
    `UPDATE platform_feature_flags
       SET status = $1, rollout_percentage = $2, updated_at = now(), updated_by = $3
     WHERE id = $4`,
    [status, pct, actor.id, id]
  );
  const after = await getFlagOrThrow(id);
  await recordAudit(actor, {
    action: "platform.feature_flag_status",
    targetType: "feature_flag",
    targetId: id,
    institutionId: null,
    detail: {
      key: after.key,
      diff: { status: { from: before.status, to: after.status } },
      rolloutPercentage: after.rolloutPercentage,
      reason: reason ?? null,
    },
  });
  return after;
}

// ---------------------------------------------------------------------------
// Settings history + safe rollback
// ---------------------------------------------------------------------------

const HISTORY_TARGETS: Record<string, string[]> = {
  settings: ["platform_settings"],
  feature_flag: ["feature_flag"],
  all: ["platform_settings", "feature_flag"],
};

export async function listSettingsHistory(opts: {
  scope?: "all" | "settings" | "feature_flag";
  page?: number;
  pageSize?: number;
}): Promise<{ rows: unknown[]; total: number; page: number; pageSize: number }> {
  const targets = HISTORY_TARGETS[opts.scope ?? "all"] ?? HISTORY_TARGETS.all;
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const totalRes = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM platform_audit_log WHERE target_type = ANY($1)`,
    [targets]
  );
  const { rows } = await query(
    `SELECT id, action, target_type AS "targetType", target_id AS "targetId",
            institution_id AS "institutionId", actor_id AS "actorId",
            actor_email AS "actorEmail", actor_role AS "actorRole", detail, ip,
            created_at AS "createdAt"
       FROM platform_audit_log
      WHERE target_type = ANY($1)
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [targets, pageSize, offset]
  );
  return { rows, total: Number(totalRes.rows[0]?.count ?? 0), page, pageSize };
}

/**
 * Safe rollback — only a global platform-settings *update* can be rolled back,
 * by re-applying the recorded `from` values for the keys it changed. Secrets are
 * never involved (platform_settings holds none); billing/invoice history and
 * tenant lifecycle are NOT touchable here.
 */
export async function rollbackSettings(
  auditId: string,
  reason: string | undefined,
  actor: Actor
): Promise<PlatformSettings> {
  const { rows } = await query<{ action: string; targetType: string; detail: Record<string, unknown> }>(
    `SELECT action, target_type AS "targetType", detail FROM platform_audit_log WHERE id = $1`,
    [auditId]
  );
  const entry = rows[0];
  if (!entry) throw ApiError.notFound("Audit entry not found");
  if (entry.targetType !== "platform_settings" || entry.action !== "platform.settings_update") {
    throw ApiError.badRequest("Only a global platform-settings change can be rolled back");
  }
  const diff = (entry.detail?.diff ?? {}) as Record<string, { from: unknown; to: unknown }>;
  const keys = Object.keys(diff).filter((k) => k in SETTINGS_COLUMN_MAP);
  if (!keys.length) throw ApiError.badRequest("This change has nothing safe to roll back");

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const k of keys) {
    params.push(diff[k].from);
    sets.push(`${SETTINGS_COLUMN_MAP[k]} = $${params.length}`);
  }
  await getSettings();
  params.push(actor.id);
  sets.push(`updated_at = now()`, `updated_by = $${params.length}`);
  await query(`UPDATE platform_settings SET ${sets.join(", ")} WHERE id = TRUE`, params);
  const after = await getSettings();
  await recordAudit(actor, {
    action: "platform.settings_rollback",
    targetType: "platform_settings",
    targetId: null,
    institutionId: null,
    detail: {
      rolledBackAudit: auditId,
      reason: reason ?? null,
      restored: Object.fromEntries(keys.map((k) => [k, norm(diff[k].from)])),
    },
  });
  return after;
}

// ---------------------------------------------------------------------------
// Runtime status (banner) — visibility-gated for the caller's role
// ---------------------------------------------------------------------------

export async function runtimeStatus(role: string | undefined): Promise<{
  platformName: string;
  maintenance: { active: boolean; message: string | null; startsAt: string | null; endsAt: string | null };
  announcement: { active: boolean; text: string | null; visibility: string } | null;
}> {
  const s = await getSettings();
  const canSeeAnnouncement =
    s.announcementActive &&
    (s.announcementVisibility === "all_users" ||
      (s.announcementVisibility === "tenant_admins" && (role === "admin" || role === "super_admin")) ||
      (s.announcementVisibility === "super_admin" && role === "super_admin"));
  return {
    platformName: s.platformName,
    maintenance: {
      active: s.maintenanceMode,
      message: s.maintenanceMessage,
      startsAt: s.maintenanceStartsAt,
      endsAt: s.maintenanceEndsAt,
    },
    announcement: canSeeAnnouncement
      ? { active: true, text: s.announcementText, visibility: s.announcementVisibility }
      : null,
  };
}
