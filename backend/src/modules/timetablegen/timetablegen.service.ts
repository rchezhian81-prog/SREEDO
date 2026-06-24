import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import type { z } from "zod";
import type { generateSchema } from "./timetablegen.schema";

interface ClassSubject {
  section_id: string;
  subject_id: string;
  teacher_id: string | null;
}

/**
 * Greedy timetable generator. For each section it round-robins its subjects
 * across the (working-day × period) grid, skipping any slot where the subject's
 * teacher is already booked in another section — so the result never
 * double-books a teacher or a section. It is a sensible starting point that
 * admins then refine, not a global optimiser. Regenerating REPLACES the existing
 * entries for the targeted sections.
 */
export async function generateTimetable(
  input: z.infer<typeof generateSchema>,
  institutionId: string
) {
  const periodsRes = await query<{ id: string }>(
    "SELECT id FROM periods WHERE institution_id = $1 ORDER BY sort_order, name",
    [institutionId]
  );
  const periods = periodsRes.rows.map((r) => r.id);
  if (!periods.length) throw ApiError.badRequest("Add periods before generating a timetable");

  const days = input.days?.length ? [...new Set(input.days)].sort((a, b) => a - b) : [1, 2, 3, 4, 5];

  let sectionIds = input.sectionIds;
  if (sectionIds?.length) {
    const ok = await query<{ id: string }>(
      "SELECT id FROM sections WHERE id = ANY($1::uuid[]) AND institution_id = $2",
      [sectionIds, institutionId]
    );
    if (ok.rows.length !== new Set(sectionIds).size) {
      throw ApiError.badRequest("One or more sections are invalid");
    }
  } else {
    const all = await query<{ section_id: string }>(
      "SELECT DISTINCT section_id FROM class_subjects WHERE institution_id = $1",
      [institutionId]
    );
    sectionIds = all.rows.map((r) => r.section_id);
  }
  if (!sectionIds.length) {
    throw ApiError.badRequest(
      "No sections have subjects assigned yet — set up class subjects first"
    );
  }

  const cs = await query<ClassSubject>(
    "SELECT section_id, subject_id, teacher_id FROM class_subjects WHERE section_id = ANY($1::uuid[]) AND institution_id = $2",
    [sectionIds, institutionId]
  );
  const bySection = new Map<string, ClassSubject[]>();
  for (const r of cs.rows) {
    if (!bySection.has(r.section_id)) bySection.set(r.section_id, []);
    bySection.get(r.section_id)!.push(r);
  }

  const teacherBusy = new Set<string>(); // `${day}:${periodId}:${teacherId}`
  const summary: { sectionId: string; filled: number; empty: number }[] = [];

  await withTransaction(async (client) => {
    await client.query(
      "DELETE FROM timetable_entries WHERE section_id = ANY($1::uuid[]) AND institution_id = $2",
      [sectionIds, institutionId]
    );

    for (const sectionId of sectionIds!) {
      const subjects = bySection.get(sectionId) ?? [];
      let filled = 0;
      let empty = 0;
      let ptr = 0;

      for (const day of days) {
        for (const periodId of periods) {
          if (!subjects.length) {
            empty++;
            continue;
          }
          let assigned = false;
          for (let attempt = 0; attempt < subjects.length; attempt++) {
            const cand = subjects[(ptr + attempt) % subjects.length];
            const key = cand.teacher_id ? `${day}:${periodId}:${cand.teacher_id}` : null;
            if (key && teacherBusy.has(key)) continue;
            await client.query(
              `INSERT INTO timetable_entries (institution_id, section_id, day_of_week, period_id, subject_id, teacher_id)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [institutionId, sectionId, day, periodId, cand.subject_id, cand.teacher_id]
            );
            if (key) teacherBusy.add(key);
            ptr = (ptr + attempt + 1) % subjects.length;
            filled++;
            assigned = true;
            break;
          }
          if (!assigned) empty++;
        }
      }
      summary.push({ sectionId, filled, empty });
    }
  });

  return {
    sections: summary,
    sectionsScheduled: summary.length,
    totalEntries: summary.reduce((s, x) => s + x.filled, 0),
    days,
    periodsPerDay: periods.length,
  };
}
