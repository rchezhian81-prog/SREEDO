import type { z } from "zod";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../db/postgres";
import { ApiError } from "../../utils/api-error";
import { recordSecurityEvent } from "../../utils/security-audit";
import { maskFreeText } from "../platform/audit.service";
import { recordAudit, type Actor } from "./audit";
import type {
  incidentCreateSchema,
  incidentEventSchema,
  incidentListQuerySchema,
  incidentReopenSchema,
  incidentResolveSchema,
  incidentUpdateSchema,
} from "./observability.schema";

/**
 * Incident management (Super Admin L). Incidents + an append-only timeline
 * (incident_events) are NEVER hard-deleted — lifecycle is status transitions
 * only. Every mutation is audited; critical-severity create/resolve additionally
 * raises a security event so it surfaces in the Security Center. Operator
 * free-text is run through maskFreeText so a pasted secret never persists.
 */

const SELECT = `
  id, title, severity, status, type, impact, root_cause AS "rootCause",
  resolution, owner_id AS "ownerId", related_alert_id AS "relatedAlertId",
  related_audit_id AS "relatedAuditId", started_at AS "startedAt",
  resolved_at AS "resolvedAt", created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const CLOSED_STATUSES = ["resolved", "closed"] as const;

type ListQuery = z.infer<typeof incidentListQuerySchema>;
type CreateInput = z.infer<typeof incidentCreateSchema>;
type UpdateInput = z.infer<typeof incidentUpdateSchema>;
type ResolveInput = z.infer<typeof incidentResolveSchema>;
type ReopenInput = z.infer<typeof incidentReopenSchema>;
type EventInput = z.infer<typeof incidentEventSchema>;

const mask = (v: string | null | undefined): string | null =>
  v == null ? null : (maskFreeText(v) as string);

/** Append one timeline event (inside the caller's transaction when provided). */
async function addEvent(
  client: PoolClient,
  incidentId: string,
  kind: string,
  actor: Actor,
  extra: { note?: string | null; fromStatus?: string | null; toStatus?: string | null } = {}
): Promise<void> {
  await client.query(
    `INSERT INTO incident_events (incident_id, kind, note, from_status, to_status, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [incidentId, kind, mask(extra.note ?? null), extra.fromStatus ?? null, extra.toStatus ?? null, actor.id]
  );
}

export async function listIncidents(q: ListQuery) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (clause: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(clause(params.length));
  };
  if (q.status) add((n) => `status = $${n}`, q.status);
  if (q.severity) add((n) => `severity = $${n}`, q.severity);
  if (q.type) add((n) => `type = $${n}`, q.type);
  if (q.active) where.push(`status IN ('open','investigating','monitoring')`);
  if (q.q) add((n) => `title ILIKE $${n}`, `%${q.q}%`);
  if (q.dateFrom) add((n) => `started_at >= $${n}`, `${q.dateFrom}T00:00:00.000Z`);
  if (q.dateTo) add((n) => `started_at <= $${n}`, `${q.dateTo}T23:59:59.999Z`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = Number(
    (await query<{ n: number }>(`SELECT count(*)::int AS n FROM incidents ${whereSql}`, params)).rows[0].n
  );
  const pageParams = [...params, q.pageSize, (q.page - 1) * q.pageSize];
  const { rows } = await query(
    `SELECT ${SELECT} FROM incidents ${whereSql}
     ORDER BY started_at DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );
  return { rows, total, page: q.page, pageSize: q.pageSize };
}

export async function getIncident(id: string) {
  const { rows } = await query(`SELECT ${SELECT} FROM incidents WHERE id = $1`, [id]);
  if (!rows[0]) throw ApiError.notFound("Incident not found");
  const { rows: timeline } = await query(
    `SELECT id, kind, note, from_status AS "fromStatus", to_status AS "toStatus",
            actor_id AS "actorId", created_at AS "createdAt"
     FROM incident_events WHERE incident_id = $1 ORDER BY created_at ASC, id ASC`,
    [id]
  );
  return { ...rows[0], timeline };
}

export async function createIncident(input: CreateInput, actor: Actor) {
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO incidents (title, severity, type, impact, owner_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [mask(input.title), input.severity, input.type, mask(input.impact ?? null), input.ownerId ?? null, actor.id]
    );
    const newId = rows[0].id;
    await addEvent(client, newId, "created", actor, {
      note: input.note ?? `Incident opened (${input.severity})`,
      toStatus: "open",
    });
    return newId;
  });

  await recordAudit(actor, {
    action: "incident.created",
    targetId: id,
    detail: { title: mask(input.title), severity: input.severity, type: input.type },
  });
  if (input.severity === "critical") {
    await recordSecurityEvent({
      action: "incident.created",
      targetType: "incident",
      targetId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      detail: { severity: "critical", type: input.type },
      ip: actor.ip,
    });
  }
  return getIncident(id);
}

async function loadRow(id: string) {
  const { rows } = await query<{
    id: string;
    status: string;
    severity: string;
    ownerId: string | null;
    resolvedAt: Date | null;
  }>(
    `SELECT id, status, severity, owner_id AS "ownerId", resolved_at AS "resolvedAt"
     FROM incidents WHERE id = $1`,
    [id]
  );
  if (!rows[0]) throw ApiError.notFound("Incident not found");
  return rows[0];
}

export async function updateIncident(id: string, input: UpdateInput, actor: Actor) {
  const existing = await loadRow(id);
  let resolvedThisCall = false;
  let reopenedThisCall = false;

  await withTransaction(async (client) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, value: unknown) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };
    if (input.title !== undefined) set("title", mask(input.title));
    if (input.type !== undefined) set("type", input.type);
    if (input.impact !== undefined) set("impact", mask(input.impact));
    if (input.rootCause !== undefined) set("root_cause", mask(input.rootCause));
    if (input.resolution !== undefined) set("resolution", mask(input.resolution));
    if (input.severity !== undefined && input.severity !== existing.severity) {
      set("severity", input.severity);
    }
    if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) {
      set("owner_id", input.ownerId);
    }

    // Status transition (with resolved_at bookkeeping — reopen clears it).
    if (input.status !== undefined && input.status !== existing.status) {
      set("status", input.status);
      const nowClosed = (CLOSED_STATUSES as readonly string[]).includes(input.status);
      const wasClosed = (CLOSED_STATUSES as readonly string[]).includes(existing.status);
      if (nowClosed && existing.resolvedAt == null) {
        sets.push(`resolved_at = now()`);
        resolvedThisCall = true;
      } else if (!nowClosed && wasClosed) {
        sets.push(`resolved_at = NULL`);
        reopenedThisCall = true;
      }
    }

    if (sets.length > 0) {
      params.push(id);
      await client.query(`UPDATE incidents SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    }

    // Timeline events for the meaningful changes.
    if (input.status !== undefined && input.status !== existing.status) {
      const kind = resolvedThisCall ? "resolved" : reopenedThisCall ? "reopened" : "status_change";
      await addEvent(client, id, kind, actor, {
        note: input.note ?? null,
        fromStatus: existing.status,
        toStatus: input.status,
      });
    } else if (input.severity !== undefined && input.severity !== existing.severity) {
      await addEvent(client, id, "severity_change", actor, { note: input.note ?? `Severity → ${input.severity}` });
    } else if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) {
      await addEvent(client, id, "assigned", actor, { note: input.note ?? "Owner reassigned" });
    } else if (input.note) {
      await addEvent(client, id, "note", actor, { note: input.note });
    }
  });

  await recordAudit(actor, {
    action: resolvedThisCall ? "incident.resolved" : reopenedThisCall ? "incident.reopened" : "incident.updated",
    targetId: id,
    detail: {
      fields: Object.keys(input),
      ...(input.status ? { status: input.status } : {}),
      ...(input.severity ? { severity: input.severity } : {}),
    },
  });

  const sevAfter = input.severity ?? existing.severity;
  if (resolvedThisCall && sevAfter === "critical") {
    await recordSecurityEvent({
      action: "incident.resolved",
      targetType: "incident",
      targetId: id,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      detail: { severity: "critical" },
      ip: actor.ip,
    });
  }
  return getIncident(id);
}

export async function resolveIncident(id: string, input: ResolveInput, actor: Actor) {
  const existing = await loadRow(id);
  if ((CLOSED_STATUSES as readonly string[]).includes(existing.status)) {
    throw ApiError.badRequest(`Incident is already ${existing.status}`);
  }
  return updateIncident(
    id,
    { status: "resolved", ...(input.resolution ? { resolution: input.resolution } : {}), ...(input.note ? { note: input.note } : {}) },
    actor
  );
}

export async function reopenIncident(id: string, input: ReopenInput, actor: Actor) {
  const existing = await loadRow(id);
  if (!(CLOSED_STATUSES as readonly string[]).includes(existing.status)) {
    throw ApiError.badRequest(`Only a resolved/closed incident can be reopened (is ${existing.status})`);
  }
  return updateIncident(id, { status: "investigating", ...(input.note ? { note: input.note } : {}) }, actor);
}

export async function addIncidentEvent(id: string, input: EventInput, actor: Actor) {
  await loadRow(id);
  await withTransaction(async (client) => {
    await addEvent(client, id, "note", actor, { note: input.note });
  });
  await recordAudit(actor, {
    action: "incident.note_added",
    targetId: id,
    detail: { note: mask(input.note) },
  });
  return getIncident(id);
}
