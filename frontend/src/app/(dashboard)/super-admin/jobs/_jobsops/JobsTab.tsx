"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
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
import type { JobBulkResult, JobListResult, JobRow } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { JobDetailModal } from "./JobDetailModal";
import {
  JOB_FILTER_STATUSES,
  SOURCE_MODULES,
  formatDateTime,
  formatExt,
  isUuid,
  jobStatusLabel,
  jobStatusTone,
  shortId,
  type JobSort,
  downloadFile,
} from "./taxonomy";

const MIN_REASON = 5;
const PAGE_SIZE = 50;

interface Filters {
  q: string;
  status: string;
  type: string;
  queue: string;
  module: string;
  workerId: string;
  institutionId: string;
  attemptsMin: string;
  createdFrom: string;
  createdTo: string;
  startedFrom: string;
  startedTo: string;
  completedFrom: string;
  completedTo: string;
}

const EMPTY_FILTERS: Filters = {
  q: "",
  status: "",
  type: "",
  queue: "",
  module: "",
  workerId: "",
  institutionId: "",
  attemptsMin: "",
  createdFrom: "",
  createdTo: "",
  startedFrom: "",
  startedTo: "",
  completedFrom: "",
  completedTo: "",
};

type Pending =
  | { mode: "single"; action: "retry" | "cancel"; job: JobRow }
  | { mode: "bulk"; action: "retry" | "cancel" | "dead_letter"; ids: string[] }
  | null;

export function JobsTab({ reloadKey }: { reloadKey: number }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sort, setSort] = useState<JobSort>("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<JobListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [bulkResult, setBulkResult] = useState<JobBulkResult | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  // Build the shared query (filters + sort). `paging` adds page/pageSize.
  const buildParams = useCallback(
    (paging: boolean): URLSearchParams => {
      const p = new URLSearchParams();
      if (filters.q.trim()) p.set("q", filters.q.trim());
      if (filters.status) p.set("status", filters.status);
      if (filters.type.trim()) p.set("type", filters.type.trim());
      if (filters.queue.trim()) p.set("queue", filters.queue.trim());
      if (filters.module) p.set("module", filters.module);
      if (filters.workerId.trim()) p.set("workerId", filters.workerId.trim());
      if (isUuid(filters.institutionId)) p.set("institutionId", filters.institutionId.trim());
      if (filters.attemptsMin.trim() !== "") p.set("attemptsMin", filters.attemptsMin.trim());
      if (filters.createdFrom) p.set("createdFrom", filters.createdFrom);
      if (filters.createdTo) p.set("createdTo", filters.createdTo);
      if (filters.startedFrom) p.set("startedFrom", filters.startedFrom);
      if (filters.startedTo) p.set("startedTo", filters.startedTo);
      if (filters.completedFrom) p.set("completedFrom", filters.completedFrom);
      if (filters.completedTo) p.set("completedTo", filters.completedTo);
      p.set("sort", sort);
      p.set("order", order);
      if (paging) {
        p.set("page", String(page));
        p.set("pageSize", String(PAGE_SIZE));
      }
      return p;
    },
    [filters, sort, order, page]
  );

  const listQuery = useMemo(() => buildParams(true).toString(), [buildParams]);
  // Reset to page 1 whenever the filter/sort selection changes.
  const filterKey = useMemo(() => buildParams(false).toString(), [buildParams]);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<JobListResult>(`/jobs-ops/jobs?${listQuery}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [listQuery]);

  useEffect(() => {
    load();
  }, [load, reloadKey, localReload]);

  const refresh = () => setLocalReload((k) => k + 1);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Selection helpers (scoped to the current page).
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPage) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  const toggleSort = (col: JobSort) => {
    if (sort === col) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(col);
      setOrder("desc");
    }
  };

  const selectedIds = [...selected];

  return (
    <section className="space-y-4">
      {/* Filters */}
      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            value={filters.q}
            onChange={(e) => patch({ q: e.target.value })}
            placeholder="Search id, type, tenant, error…"
            aria-label="Search jobs"
          />
          <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {JOB_FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {jobStatusLabel(s)}
              </option>
            ))}
          </Select>
          <Select value={filters.module} onChange={(e) => patch({ module: e.target.value })} aria-label="Source module">
            <option value="">All modules</option>
            {SOURCE_MODULES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Input
            value={filters.type}
            onChange={(e) => patch({ type: e.target.value })}
            placeholder="Job type (exact)"
            aria-label="Job type"
          />
        </div>

        {showAdvanced && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              value={filters.queue}
              onChange={(e) => patch({ queue: e.target.value })}
              placeholder="Queue"
              aria-label="Queue"
            />
            <Input
              value={filters.workerId}
              onChange={(e) => patch({ workerId: e.target.value })}
              placeholder="Worker id"
              aria-label="Worker id"
            />
            <Field label="Tenant UUID" error={filters.institutionId && !isUuid(filters.institutionId) ? "Enter a full UUID" : undefined}>
              <Input
                value={filters.institutionId}
                onChange={(e) => patch({ institutionId: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </Field>
            <Field label="Min attempts">
              <Input
                type="number"
                min={0}
                value={filters.attemptsMin}
                onChange={(e) => patch({ attemptsMin: e.target.value })}
              />
            </Field>
            <Field label="Created from">
              <Input type="date" value={filters.createdFrom} onChange={(e) => patch({ createdFrom: e.target.value })} />
            </Field>
            <Field label="Created to">
              <Input type="date" value={filters.createdTo} onChange={(e) => patch({ createdTo: e.target.value })} />
            </Field>
            <Field label="Started from">
              <Input type="date" value={filters.startedFrom} onChange={(e) => patch({ startedFrom: e.target.value })} />
            </Field>
            <Field label="Started to">
              <Input type="date" value={filters.startedTo} onChange={(e) => patch({ startedTo: e.target.value })} />
            </Field>
            <Field label="Completed from">
              <Input type="date" value={filters.completedFrom} onChange={(e) => patch({ completedFrom: e.target.value })} />
            </Field>
            <Field label="Completed to">
              <Input type="date" value={filters.completedTo} onChange={(e) => patch({ completedTo: e.target.value })} />
            </Field>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
            <Icon name="filter" className="h-4 w-4" />
            {showAdvanced ? "Fewer filters" : "More filters"}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
              Reset
            </Button>
            <Button variant="secondary" onClick={() => setExportOpen(true)}>
              <Icon name="download" className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>
      </Card>

      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-500/30 bg-brand-500/5 px-4 py-3">
          <span className="text-sm font-medium text-ink">{formatNumber(selected.size)} selected</span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setPending({ mode: "bulk", action: "retry", ids: selectedIds })}
            >
              <Icon name="history" className="h-4 w-4" />
              Bulk retry
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPending({ mode: "bulk", action: "cancel", ids: selectedIds })}
            >
              Bulk cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => setPending({ mode: "bulk", action: "dead_letter", ids: selectedIds })}
            >
              Bulk dead-letter
            </Button>
            <Button variant="ghost" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No jobs match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allOnPage}
                      onChange={toggleAll}
                      aria-label="Select all on page"
                      className="h-4 w-4 rounded border-line"
                    />
                  </th>
                  <th className="px-4 py-3">Job</th>
                  <SortHeader label="Status" col="status" sort={sort} order={order} onSort={toggleSort} />
                  <th className="px-4 py-3">Module</th>
                  <th className="px-4 py-3">Tenant</th>
                  <SortHeader label="Attempts" col="attempts" sort={sort} order={order} onSort={toggleSort} align="right" />
                  <SortHeader label="Created" col="created_at" sort={sort} order={order} onSort={toggleSort} />
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((j) => (
                  <tr key={j.id} className="hover:bg-hover">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(j.id)}
                        onChange={() => toggleOne(j.id)}
                        aria-label={`Select job ${shortId(j.id)}`}
                        className="h-4 w-4 rounded border-line"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDetailId(j.id)}
                        className="block text-left font-medium text-ink hover:text-brand-600"
                      >
                        {j.type}
                      </button>
                      <span className="block text-xs text-faint">
                        {j.queue} · {shortId(j.id)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={jobStatusTone(j.stuck ? "stuck" : j.status)}>
                        {j.stuck ? "Stuck" : jobStatusLabel(j.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{j.sourceModule}</td>
                    <td className="px-4 py-3 text-muted">{j.institutionName ?? "Platform"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                      {formatNumber(j.attempts)} / {formatNumber(j.maxAttempts)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-faint">{formatDateTime(j.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button variant="secondary" className="!px-2.5 !py-1.5" onClick={() => setDetailId(j.id)}>
                          View
                        </Button>
                        {(j.status === "failed" || j.status === "dead_letter") && (
                          <Button
                            variant="secondary"
                            className="!px-2.5 !py-1.5"
                            onClick={() => setPending({ mode: "single", action: "retry", job: j })}
                          >
                            Retry
                          </Button>
                        )}
                        {j.status === "pending" && (
                          <Button
                            variant="secondary"
                            className="!px-2.5 !py-1.5"
                            onClick={() => setPending({ mode: "single", action: "cancel", job: j })}
                          >
                            Cancel
                          </Button>
                        )}
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
              <Icon name="chevronLeft" className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
              <Icon name="chevronRight" className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      <JobDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={refresh} />

      <JobActionDialog
        pending={pending}
        onClose={() => setPending(null)}
        onDone={(result) => {
          setPending(null);
          if (result) setBulkResult(result);
          clearSelection();
          refresh();
        }}
      />

      <BulkResultModal result={bulkResult} onClose={() => setBulkResult(null)} />

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} params={buildParams(false)} />
    </section>
  );
}

// ============================ Sortable header ==============================

function SortHeader({
  label,
  col,
  sort,
  order,
  onSort,
  align = "left",
}: {
  label: string;
  col: JobSort;
  sort: JobSort;
  order: "asc" | "desc";
  onSort: (col: JobSort) => void;
  align?: "left" | "right";
}) {
  const active = sort === col;
  return (
    <th className={`px-4 py-3 ${align === "right" ? "text-right" : ""}`}>
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 uppercase ${active ? "text-ink" : "hover:text-ink"}`}
      >
        {label}
        {active && <Icon name={order === "asc" ? "trendUp" : "trendDown"} className="h-3.5 w-3.5" />}
      </button>
    </th>
  );
}

// ============================ Action dialog ================================

function JobActionDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: Pending;
  onClose: () => void;
  onDone: (result?: JobBulkResult) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pending) {
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [pending]);

  if (!pending) return null;

  // Reason is required for every bulk action (single retry/cancel are optional).
  const reasonRequired = pending.mode === "bulk";
  const reasonOk = !reasonRequired || reason.trim().length >= MIN_REASON;

  const title =
    pending.mode === "bulk"
      ? pending.action === "retry"
        ? "Bulk retry jobs"
        : pending.action === "cancel"
          ? "Bulk cancel jobs"
          : "Bulk move to dead-letter"
      : pending.action === "retry"
        ? "Retry job"
        : "Cancel job";

  const count = pending.mode === "bulk" ? pending.ids.length : 1;
  const danger = pending.action === "cancel" || pending.action === "dead_letter";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (pending.mode === "bulk") {
        const result = await api.post<JobBulkResult>("/jobs-ops/bulk", {
          action: pending.action,
          ids: pending.ids,
          reason: reason.trim(),
        });
        toast.success(`Bulk ${pending.action.replace("_", " ")}: ${result.affected} affected, ${result.skipped.length} skipped.`);
        onDone(result);
      } else {
        const path = `/jobs-ops/jobs/${pending.job.id}/${pending.action}`;
        await api.post(path, reason.trim() ? { reason: reason.trim() } : {});
        toast.success(pending.action === "retry" ? "Job re-queued for retry." : "Job cancelled.");
        onDone();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
      setBusy(false);
    }
  };

  return (
    <Modal title={title} open={pending !== null} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          {pending.mode === "bulk" ? (
            <>
              This will attempt to <span className="font-semibold text-ink">{pending.action.replace("_", " ")}</span>{" "}
              {formatNumber(count)} selected job{count === 1 ? "" : "s"}. Jobs whose state does not allow the action are
              skipped and reported.
            </>
          ) : (
            <>
              {pending.action === "retry"
                ? "This resets the job to pending and re-queues it."
                : "This cancels the pending job."}
            </>
          )}
        </p>
        {reasonRequired && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            This action is audited. A reason of at least 5 characters is required.
          </div>
        )}
        <Field
          label={reasonRequired ? "Reason (min 5 characters)" : "Reason (optional)"}
          error={reasonRequired && reason.length > 0 && reason.trim().length < MIN_REASON ? "At least 5 characters required." : undefined}
        >
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this action being taken?" />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={submit} disabled={busy || !reasonOk}>
            {busy ? "Working…" : title}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================ Bulk result ==================================

function BulkResultModal({ result, onClose }: { result: JobBulkResult | null; onClose: () => void }) {
  if (!result) return null;
  return (
    <Modal title="Bulk action result" open={result !== null} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge tone="slate">{formatNumber(result.requested)} requested</Badge>
          <Badge tone="green">{formatNumber(result.affected)} affected</Badge>
          <Badge tone={result.skipped.length > 0 ? "amber" : "slate"}>
            {formatNumber(result.skipped.length)} skipped
          </Badge>
        </div>
        {result.skipped.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Skipped</p>
            <ul className="max-h-64 divide-y divide-line overflow-auto rounded-lg border border-line">
              {result.skipped.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span className="font-mono text-faint">{shortId(s.id)}</span>
                  <span className="min-w-0 flex-1 text-right text-muted">{s.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================ Export ========================================

function ExportModal({
  open,
  onClose,
  params,
}: {
  open: boolean;
  onClose: () => void;
  params: URLSearchParams;
}) {
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [includeAttempts, setIncludeAttempts] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormat("csv");
      setIncludeAttempts(false);
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const reasonLen = reason.trim().length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = new URLSearchParams(params);
      p.delete("sort");
      p.delete("order");
      p.set("format", format);
      p.set("reason", reason.trim());
      if (includeAttempts) p.set("includeAttempts", "true");
      await downloadFile(`/jobs-ops/export?${p.toString()}`, `jobs.${formatExt(format)}`);
      toast.success("Jobs export downloaded.");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Export jobs" open={open} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Exporting jobs is audited and every cell is masked. A reason is required and recorded in the platform audit
          log. The current filters are applied.
        </div>
        <Field label="Format">
          <Select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")}>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={includeAttempts}
            onChange={(e) => setIncludeAttempts(e.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          Include attempt counts
        </label>
        <Field
          label="Reason (min 5 characters)"
          error={reason.length > 0 && reasonLen < MIN_REASON ? "At least 5 characters required." : undefined}
        >
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this export needed?" />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || reasonLen < MIN_REASON}>
            {busy ? "Preparing…" : "Download export"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
