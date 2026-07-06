"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type {
  Incident,
  IncidentListResult,
  IncidentSeverity,
  IncidentType,
} from "@/types";
import { formatNumber } from "../../platform/_utils";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  formatDateTime,
  incidentStatusTone,
  incidentTypeLabel,
  severityTone,
  titleCase,
} from "./taxonomy";
import { IncidentDetailModal } from "./IncidentDetailModal";

interface FilterState {
  status: string;
  severity: string;
  type: string;
  q: string;
  active: boolean;
}

const EMPTY: FilterState = { status: "", severity: "", type: "", q: "", active: false };

export function IncidentsTab({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [applied, setApplied] = useState<FilterState>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [data, setData] = useState<IncidentListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setApplied(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);
  useEffect(() => {
    setPage(1);
  }, [applied]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (applied.status) p.set("status", applied.status);
    if (applied.severity) p.set("severity", applied.severity);
    if (applied.type) p.set("type", applied.type);
    if (applied.q.trim()) p.set("q", applied.q.trim());
    if (applied.active) p.set("active", "true");
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return p.toString();
  }, [applied, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<IncidentListResult>(`/observability/incidents?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refreshAll = () => {
    setLocalReload((k) => k + 1);
    onChanged();
  };

  const patch = (p: Partial<FilterState>) => setFilters((prev) => ({ ...prev, ...p }));
  const active =
    filters.status !== "" ||
    filters.severity !== "" ||
    filters.type !== "" ||
    filters.q !== "" ||
    filters.active;

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Incidents</h2>
          <Button onClick={() => setCreateOpen(true)}>
            <Icon name="plus" className="h-4 w-4" />
            Open incident
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
          <Select
            value={filters.severity}
            onChange={(e) => patch({ severity: e.target.value })}
            aria-label="Severity"
          >
            <option value="">All severities</option>
            {INCIDENT_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
          <Select value={filters.type} onChange={(e) => patch({ type: e.target.value })} aria-label="Type">
            <option value="">All types</option>
            {INCIDENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {incidentTypeLabel(t)}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Search title…"
            value={filters.q}
            onChange={(e) => patch({ q: e.target.value })}
            aria-label="Search"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={filters.active}
              onChange={(e) => patch({ active: e.target.checked })}
              className="h-4 w-4 rounded border-line"
            />
            Active only (open / investigating / monitoring)
          </label>
          {active && (
            <Button variant="ghost" onClick={() => setFilters(EMPTY)}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No incidents match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-hover">
                    <td className="max-w-md px-4 py-3">
                      <span className="block truncate font-medium text-ink">{r.title}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={severityTone(r.severity)}>{titleCase(r.severity)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={incidentStatusTone(r.status)}>{titleCase(r.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{incidentTypeLabel(r.type)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-faint">
                      {formatDateTime(r.startedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button
                          variant="secondary"
                          className="!px-3 !py-1.5"
                          onClick={() => setDetailId(r.id)}
                        >
                          Manage
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted">
            <span>
              Page {page} of {totalPages} · {formatNumber(total)} total
            </span>
            <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              ← Prev
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next →
            </Button>
          </div>
        </>
      )}

      <IncidentDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={refreshAll} />

      <CreateIncidentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refreshAll();
        }}
      />
    </div>
  );
}

function CreateIncidentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("minor");
  const [type, setType] = useState<IncidentType>("other");
  const [impact, setImpact] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setSeverity("minor");
      setType("other");
      setImpact("");
      setNote("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<Incident>("/observability/incidents", {
        title: title.trim(),
        severity,
        type,
        ...(impact.trim() ? { impact: impact.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success("Incident opened.");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to open incident");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Open incident" open={open} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <Field label="Title (min 3 characters)">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Elevated 5xx on the API"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Severity">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}>
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as IncidentType)}>
              {INCIDENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {incidentTypeLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Impact (optional)">
          <Textarea rows={2} value={impact} onChange={(e) => setImpact(e.target.value)} />
        </Field>
        <Field label="Opening note (optional)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || title.trim().length < 3}>
            {busy ? "Opening…" : "Open incident"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
