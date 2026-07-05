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
import type { Backup, BackupHistoryPage } from "@/types";
import { formatBytes, formatNumber } from "../../platform/_utils";
import {
  backupStatusTone,
  checksumLabel,
  checksumTone,
  formatDateTime,
  offsiteLabel,
  offsiteTone,
  triggerLabel,
} from "./taxonomy";
import { ExportControls } from "./ExportControls";
import { BackupDetailModal } from "./BackupDetailModal";

type SortKey = "createdAt" | "status" | "sizeBytes";

const STATUSES: Backup["status"][] = ["pending", "running", "success", "failed", "archived"];
const TRIGGERS: Backup["trigger"][] = ["manual", "scheduled", "pre_deploy", "pre_restore"];

interface FilterState {
  dateFrom: string;
  dateTo: string;
  status: string;
  scope: string;
  trigger: string;
  createdBy: string;
}

const EMPTY: FilterState = {
  dateFrom: "",
  dateTo: "",
  status: "",
  scope: "",
  trigger: "",
  createdBy: "",
};

export function BackupsTab({
  presetRange,
  presetKey,
  reloadKey,
  onChanged,
}: {
  presetRange: { dateFrom: string; dateTo: string } | null;
  presetKey: number;
  reloadKey: number;
  onChanged: () => void;
}) {
  const [filters, setFilters] = useState<FilterState>(EMPTY);
  const [applied, setApplied] = useState<FilterState>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [data, setData] = useState<BackupHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  const [detail, setDetail] = useState<Backup | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // A date range picked from the Overview chips feeds straight into the filters.
  useEffect(() => {
    if (presetKey > 0 && presetRange) {
      setFilters((prev) => ({ ...prev, dateFrom: presetRange.dateFrom, dateTo: presetRange.dateTo }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetKey]);

  // Debounce filter edits into the applied set; reset to page 1 on change.
  useEffect(() => {
    const t = setTimeout(() => setApplied(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);
  useEffect(() => {
    setPage(1);
  }, [applied]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(applied)) if (v.trim()) p.set(k, v.trim());
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    p.set("sort", sort);
    p.set("order", order);
    return p.toString();
  }, [applied, page, pageSize, sort, order]);

  const exportParams = useMemo(() => {
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(applied)) if (v.trim()) p[k] = v.trim();
    return p;
  }, [applied]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<BackupHistoryPage>(`/backups/history?${query}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load backup history");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  // A mutation refreshes this table AND any sibling tab (e.g. Restore requests).
  const refreshAll = () => {
    setLocalReload((k) => k + 1);
    onChanged();
  };

  const patch = (p: Partial<FilterState>) => setFilters((prev) => ({ ...prev, ...p }));
  const active = Object.values(filters).some((v) => v.trim() !== "");

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder("desc");
    }
    setPage(1);
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const arrow = (key: SortKey) => (sort === key ? (order === "asc" ? " ↑" : " ↓") : "");
  const sortableTh = "cursor-pointer select-none px-4 py-3 hover:text-ink";

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Backup history</h2>
          <div className="flex flex-wrap items-center gap-2">
            <ExportControls
              endpoint="/backups/history/export"
              params={exportParams}
              filename="backup-history"
            />
            <Button onClick={() => setCreateOpen(true)}>
              <Icon name="plus" className="h-4 w-4" />
              Create backup
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <Select value={filters.scope} onChange={(e) => patch({ scope: e.target.value })} aria-label="Scope">
            <option value="">All scopes</option>
            <option value="global">Global</option>
            <option value="institution">Institution</option>
          </Select>
          <Select value={filters.trigger} onChange={(e) => patch({ trigger: e.target.value })} aria-label="Trigger">
            <option value="">All triggers</option>
            {TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {triggerLabel(t)}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Created by (user ID)"
            value={filters.createdBy}
            onChange={(e) => patch({ createdBy: e.target.value })}
            aria-label="Created by"
          />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">From date</span>
            <Input type="date" value={filters.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">To date</span>
            <Input type="date" value={filters.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} />
          </label>
        </div>
        {active && (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setFilters(EMPTY)}>
              Clear all filters
            </Button>
          </div>
        )}
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No backups match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className={sortableTh} onClick={() => toggleSort("createdAt")}>
                    Created{arrow("createdAt")}
                  </th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3">Trigger</th>
                  <th className={sortableTh} onClick={() => toggleSort("status")}>
                    Status{arrow("status")}
                  </th>
                  <th className={sortableTh} onClick={() => toggleSort("sizeBytes")}>
                    Size{arrow("sizeBytes")}
                  </th>
                  <th className="px-4 py-3">Rows</th>
                  <th className="px-4 py-3">Checksum</th>
                  <th className="px-4 py-3">Off-site</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((b) => (
                  <tr key={b.id} className="align-top hover:bg-hover">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(b.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={b.scope === "global" ? "blue" : "slate"}>{b.scope}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{triggerLabel(b.trigger)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={backupStatusTone(b.status)}>{b.status}</Badge>
                      {b.status === "failed" && b.error && (
                        <span className="mt-1 block max-w-xs truncate text-xs text-red-600" title={b.error}>
                          {b.error}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {b.sizeBytes == null ? "—" : formatBytes(b.sizeBytes)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">
                      {b.rowCount == null ? "—" : formatNumber(b.rowCount)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={checksumTone(b.checksumStatus)}>{checksumLabel(b.checksumStatus)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={offsiteTone(b.offsite)}>{offsiteLabel(b.offsite)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => setDetail(b)}>
                          Manage
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))} className="w-20">
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-2">
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
          </div>
        </>
      )}

      <BackupDetailModal
        backup={detail}
        onClose={() => setDetail(null)}
        onChanged={refreshAll}
      />

      <CreateBackupModal
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

/** Confirm + optional reason before triggering a manual global backup. */
function CreateBackupModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<Backup>("/backups", {
        scope: "global",
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success("Backup started — it will appear in the history shortly.");
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start backup");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create a global backup" open={open} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Starts a full, global snapshot of the platform database. It runs in the background and
          appears in the history when complete.
        </p>
        <Field label="Reason (optional)" hint="Recorded in the audit log.">
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Manual snapshot before maintenance window"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Starting…" : "Create backup"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
