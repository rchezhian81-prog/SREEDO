"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, EmptyState, ErrorNote, Select, Spinner } from "@/components/ui";
import type { RestoreRequest, RestoreRequestPage, RestoreRequestStatus } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { formatDateTime, restoreStatusTone, shortId, titleCase } from "./taxonomy";
import { RestoreDetailModal } from "./RestoreDetailModal";

const STATUS_OPTIONS: { value: "" | RestoreRequestStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "executed", label: "Executed" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
  { value: "failed", label: "Failed" },
];

export function RestoreTab({
  reloadKey,
  onChanged,
}: {
  reloadKey: number;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<"" | RestoreRequestStatus>("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [data, setData] = useState<RestoreRequestPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (status) p.set("status", status);
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      setData(await api.get<RestoreRequestPage>(`/backups/restore-requests?${p.toString()}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load restore requests");
    } finally {
      setLoading(false);
    }
  }, [status, page, pageSize]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refreshAll = () => {
    setLocalReload((k) => k + 1);
    onChanged();
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const detail = rows.find((r) => r.id === detailId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Status</span>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | RestoreRequestStatus)}
            className="min-w-48"
            aria-label="Restore request status"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <p className="max-w-md text-xs text-faint">
          A restore must be requested, approved by another super admin, then executed against a typed
          confirmation phrase. Every step is audited; nothing here is ever deleted.
        </p>
      </div>

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No restore requests match this filter." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Backup</th>
                  <th className="px-4 py-3">Requester</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Decided by</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-hover">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(r.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="block font-mono text-xs text-ink">{shortId(r.backupId)}</span>
                      <span className="block text-xs text-faint capitalize">
                        {r.backupScope} · {r.scope}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{r.requestedByEmail ?? r.requestedBy ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={restoreStatusTone(r.status)}>{titleCase(r.status)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block max-w-[16rem] whitespace-normal break-words text-ink">
                        {r.reason ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {r.decidedByEmail ?? r.decidedBy ?? "—"}
                      {r.decidedAt && (
                        <span className="block text-xs text-faint">{formatDateTime(r.decidedAt)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => setDetailId(r.id)}>
                          {r.status === "pending" ? "Review" : r.status === "approved" ? "Execute…" : "View"}
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

      <RestoreDetailModal
        request={detail}
        onClose={() => setDetailId(null)}
        onChanged={refreshAll}
      />
    </div>
  );
}
