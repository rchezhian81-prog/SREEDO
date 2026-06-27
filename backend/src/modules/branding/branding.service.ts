import { query } from "../../db/postgres";
import type { z } from "zod";
import type { updateBrandingSchema } from "./branding.schema";

export async function getBranding(institutionId: string) {
  const { rows } = await query(
    `SELECT display_name AS "displayName", logo_url AS "logoUrl",
            primary_color AS "primaryColor", tagline, updated_at AS "updatedAt"
     FROM institution_branding WHERE institution_id = $1`,
    [institutionId]
  );
  return (
    rows[0] ?? {
      displayName: null,
      logoUrl: null,
      primaryColor: null,
      tagline: null,
      updatedAt: null,
    }
  );
}

export async function upsertBranding(
  input: z.infer<typeof updateBrandingSchema>,
  institutionId: string
) {
  // Normalise empty strings to NULL.
  const clean = (v: string | null | undefined) => (v === "" || v === undefined ? null : v);
  await query(
    `INSERT INTO institution_branding (institution_id, display_name, logo_url, primary_color, tagline, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (institution_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       logo_url = EXCLUDED.logo_url,
       primary_color = EXCLUDED.primary_color,
       tagline = EXCLUDED.tagline,
       updated_at = now()`,
    [
      institutionId,
      clean(input.displayName),
      clean(input.logoUrl),
      clean(input.primaryColor),
      clean(input.tagline),
    ]
  );
  return getBranding(institutionId);
}
