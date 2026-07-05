"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  ErrorNote,
  Field,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { Incident, IncidentSeverity, IncidentStatus, IncidentType } from "@/types";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  formatDateTime,
  incidentStatusTone,
  incidentTypeLabel,
  severityTone,
  shortId,
  timelineKindTone,
  titleCase,
} from "./taxonomy";

type View = "menu" | "edit" | "resolve" | "reopen" | "note";

const CLOSED = ["resolved", "closed"];

interface EditForm {
  status: IncidentStatus;
  severity: IncidentSeverity;
  type: IncidentType;
  impact: string;
  rootCause: string;
  resolution: string;
  note: string;
}

export function IncidentDetailModal({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<EditForm | null>(null);
  const [resolution, setResolution] = useState("");
  const [note, setNote] = useState("");

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setIncident(await api.get<Incident>(`/observability/incidents/${id}`));
    } catch (err) {
      setIncident(null);
      setError(err instanceof ApiError ? err.message : "Failed to load incident");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      setView("menu");
      setBusy(false);
      setError(null);
      setResolution("");
      setNote("");
      reload();
    }
  }, [id, reload]);

  if (!id) return null;

  const startEdit = () => {
    if (!incident) return;
    setForm({
      status: incident.status,
      severity: incident.severity,
      type: incident.type,
      impact: incident.impact ?? "",
      rootCause: incident.rootCause ?? "",
      resolution: incident.resolution ?? "",
      note: "",
    });
    setError(null);
    setView("edit");
  };

  const patchForm = (p: Partial<EditForm>) => setForm((f) => (f ? { ...f, ...p } : f));

  const applyResult = (updated: Incident) => {
    setIncident(updated);
    onChanged();
  };

  const saveEdit = async () => {
    if (!incident || !form) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (form.status !== incident.status) body.status = form.status;
      if (form.severity !== incident.severity) body.severity = form.severity;
      if (form.type !== incident.type) body.type = form.type;
      if (form.impact.trim() !== (incident.impact ?? "")) body.impact = form.impact.trim() || null;
      if (form.rootCause.trim() !== (incident.rootCause ?? ""))
        body.rootCause = form.rootCause.trim() || null;
      if (form.resolution.trim() !== (incident.resolution ?? ""))
        body.resolution = form.resolution.trim() || null;
      if (form.note.trim()) body.note = form.note.trim();
      if (Object.keys(body).length === 0) {
        setView("menu");
        return;
      }
      applyResult(await api.patch<Incident>(`/observability/incidents/${incident.id}`, body));
      toast.success("Incident updated.");
      setView("menu");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update incident");
    } finally {
      setBusy(false);
    }
  };

  const doResolve = async () => {
    if (!incident) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (resolution.trim()) body.resolution = resolution.trim();
      if (note.trim()) body.note = note.trim();
      applyResult(await api.post<Incident>(`/observability/incidents/${incident.id}/resolve`, body));
      toast.success("Incident resolved.");
      setResolution("");
      setNote("");
      setView("menu");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to resolve incident");
    } finally {
      setBusy(false);
    }
  };

  const doReopen = async () => {
    if (!incident) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (note.trim()) body.note = note.trim();
      applyResult(await api.post<Incident>(`/observability/incidents/${incident.id}/reopen`, body));
      toast.success("Incident reopened.");
      setNote("");
      setView("menu");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reopen incident");
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    if (!incident || note.trim().length < 1) return;
    setBusy(true);
    setError(null);
    try {
      applyResult(
        await api.post<Incident>(`/observability/incidents/${incident.id}/events`, {
          note: note.trim(),
        })
      );
      toast.success("Note added.");
      setNote("");
      setView("menu");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add note");
    } finally {
      setBusy(false);
    }
  };

  const isClosed = incident ? CLOSED.includes(incident.status) : false;

  const title =
    view === "edit"
      ? "Edit incident"
      : view === "resolve"
        ? "Resolve incident"
        : view === "reopen"
          ? "Reopen incident"
          : view === "note"
            ? "Add note"
            : incident
              ? incident.title
              : "Incident";

  return (
    <Modal title={title} open={id !== null} onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : !incident ? (
        <ErrorNote message={error ?? "Incident not found."} />
      ) : view === "menu" ? (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={severityTone(incident.severity)}>{titleCase(incident.severity)}</Badge>
            <Badge tone={incidentStatusTone(incident.status)}>{titleCase(incident.status)}</Badge>
            <Badge tone="slate">{incidentTypeLabel(incident.type)}</Badge>
          </div>

          <dl className="space-y-2">
            <Row label="Incident" value={<span className="font-mono text-xs">{shortId(incident.id)}</span>} />
            <Row label="Started" value={formatDateTime(incident.startedAt)} />
            <Row label="Resolved" value={formatDateTime(incident.resolvedAt)} />
            <Row label="Impact" value={incident.impact || "—"} />
            <Row label="Root cause" value={incident.rootCause || "—"} />
            <Row label="Resolution" value={incident.resolution || "—"} />
            {incident.ownerId && <Row label="Owner" value={<span className="font-mono text-xs">{shortId(incident.ownerId)}</span>} />}
            {incident.relatedAlertId && (
              <Row label="From alert" value={<span className="font-mono text-xs">{shortId(incident.relatedAlertId)}</span>} />
            )}
            <Row label="Updated" value={formatDateTime(incident.updatedAt)} />
          </dl>

          <ErrorNote message={error} />

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={startEdit} disabled={busy}>
              <Icon name="wrench" className="h-4 w-4" />
              Edit
            </Button>
            <Button variant="secondary" onClick={() => setView("note")} disabled={busy}>
              Add note
            </Button>
            {isClosed ? (
              <Button onClick={() => setView("reopen")} disabled={busy}>
                Reopen
              </Button>
            ) : (
              <Button onClick={() => setView("resolve")} disabled={busy}>
                Resolve
              </Button>
            )}
          </div>

          {/* Timeline */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Timeline</p>
            {!incident.timeline || incident.timeline.length === 0 ? (
              <p className="text-muted">No timeline events.</p>
            ) : (
              <ul className="space-y-2">
                {incident.timeline.map((e) => (
                  <li key={e.id} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={timelineKindTone(e.kind)}>{titleCase(e.kind.replace(/_/g, " "))}</Badge>
                        {e.fromStatus && e.toStatus && (
                          <span className="text-xs text-faint">
                            {e.fromStatus} → {e.toStatus}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-faint">{formatDateTime(e.createdAt)}</span>
                    </div>
                    {e.note && <p className="mt-1 text-xs text-muted">{e.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : view === "edit" && form ? (
        <div className="space-y-4 text-sm">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) => patchForm({ status: e.target.value as IncidentStatus })}
              >
                {INCIDENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Severity">
              <Select
                value={form.severity}
                onChange={(e) => patchForm({ severity: e.target.value as IncidentSeverity })}
              >
                {INCIDENT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type">
              <Select
                value={form.type}
                onChange={(e) => patchForm({ type: e.target.value as IncidentType })}
              >
                {INCIDENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {incidentTypeLabel(t)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Impact">
            <Textarea rows={2} value={form.impact} onChange={(e) => patchForm({ impact: e.target.value })} />
          </Field>
          <Field label="Root cause">
            <Textarea rows={2} value={form.rootCause} onChange={(e) => patchForm({ rootCause: e.target.value })} />
          </Field>
          <Field label="Resolution">
            <Textarea rows={2} value={form.resolution} onChange={(e) => patchForm({ resolution: e.target.value })} />
          </Field>
          <Field label="Note (added to the timeline)">
            <Textarea rows={2} value={form.note} onChange={(e) => patchForm({ note: e.target.value })} />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button onClick={saveEdit} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      ) : view === "resolve" ? (
        <div className="space-y-4 text-sm">
          <p className="text-muted">Resolving sets the resolved time and closes the incident.</p>
          <Field label="Resolution (optional)">
            <Textarea rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </Field>
          <Field label="Note (optional)">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button onClick={doResolve} disabled={busy}>
              {busy ? "Resolving…" : "Resolve incident"}
            </Button>
          </div>
        </div>
      ) : view === "reopen" ? (
        <div className="space-y-4 text-sm">
          <p className="text-muted">Reopening moves the incident back to investigating.</p>
          <Field label="Note (optional)">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button onClick={doReopen} disabled={busy}>
              {busy ? "Reopening…" : "Reopen incident"}
            </Button>
          </div>
        </div>
      ) : view === "note" ? (
        <div className="space-y-4 text-sm">
          <Field label="Note (required)">
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context to the incident timeline…"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setView("menu")} disabled={busy}>
              Back
            </Button>
            <Button onClick={addNote} disabled={busy || note.trim().length < 1}>
              {busy ? "Adding…" : "Add note"}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 font-medium text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
