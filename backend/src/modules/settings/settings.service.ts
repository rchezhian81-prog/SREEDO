import { query } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { InstitutionType } from "../../middleware/institution-type";
import { listAcademicYears } from "../academics/academics.service";
import { getBranding } from "../branding/branding.service";
import { setInstitutionType } from "../college/college.service";

// Unified tenant-settings aggregator. It READS the tenant-editable settings that
// today live scattered across modules (institution profile, school/college mode,
// academic years, branding, enabled modules) into one payload, and exposes the
// ONE canonical mode switch. It stores no new data — `institutions.type` remains
// the single source of truth for school/college mode.

export async function getTenantSettings(institutionId: string) {
  const { rows } = await query<{
    id: string;
    name: string;
    code: string;
    type: InstitutionType;
    isActive: boolean;
    settings: { enabledModules?: unknown } | null;
    createdAt: string;
  }>(
    `SELECT id, name, code, type, is_active AS "isActive", settings, created_at AS "createdAt"
     FROM institutions WHERE id = $1`,
    [institutionId]
  );
  const inst = rows[0];
  if (!inst) throw ApiError.notFound("Institution not found");

  const academicYears = await listAcademicYears(institutionId);
  const currentYear =
    (academicYears as { isCurrent?: boolean }[]).find((y) => y.isCurrent) ?? null;
  const branding = await getBranding(institutionId);
  const enabledModules = Array.isArray(inst.settings?.enabledModules)
    ? (inst.settings!.enabledModules as string[])
    : [];

  return {
    // Institution profile is PLATFORM-managed (name/code are set by Super Admin);
    // surfaced read-only here so the tenant admin sees it in one place.
    institution: {
      id: inst.id,
      name: inst.name,
      code: inst.code,
      isActive: inst.isActive,
      createdAt: inst.createdAt,
    },
    profileManagedBy: "platform" as const,
    // The SINGLE source of truth for school/college mode.
    mode: inst.type,
    academicYears,
    currentYear,
    branding: branding ?? null,
    // Enabled modules are plan/platform-driven — read-only here.
    enabledModules,
  };
}

/** Canonical school↔college switch. Reuses the single writer of
 *  institutions.type (busts the type cache) and returns the fresh settings. */
export async function switchMode(institutionId: string, type: InstitutionType) {
  await setInstitutionType(institutionId, type);
  return getTenantSettings(institutionId);
}
