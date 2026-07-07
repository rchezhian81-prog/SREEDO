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
import type { DeliveryListResult, DeliveryRetryResult, DeliveryRow } from "@/types";
import { formatNumber } from "../../platform/_utils";
import { DeliveryDetailDrawer } from "./DeliveryDetailDrawer";
import {
  DELIVERY_STATUSES,
  TRIGGER_SOURCES,
  deliveryStatusTone,
  formatDateTime,
  formatExt,
  isUuid,
  sourceLabel,
  titleCase,
  downloadFile,
} from "./taxonomy";

const MIN_REASON = 5;
const PAGE_SIZE = 50;

type Sort = "createdAt" | "status" | "triggerSource" | "template";

interface Filters {
  q: string;
  status: string;
  template: string;
  category: string;
  tenant: string;
  triggerSource: string;
  recipient: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = {
  q: "",
  status: "",
  template: "",
  category: "",
  tenant: "",
  triggerSource: "",
  recipient: "",
  dateFrom: "",
  dateTo: "",
};

export function DeliveriesTab({ reloadKey }: { reloadKey: number }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sort, setSort] = useState<Sort>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DeliveryListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [retryRow, setRetryRow] = useState<DeliveryRow | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const buildParams = useCallback(
    (paging: boolean): URLSearchParams => {
      const p = new URLSearchParams();
      if (filters.q.trim()) p.set("q", filters.q.trim());
      if (filters.status) p.set("status", filters.status);
      if (filters.template.trim()) p.set("template", filters.template.trim());
      if (filters.category.trim()) p.set("category", filters.category.trim());
      if (isUuid(filters.tenant)) p.set("tenant", filters.tenant.trim());
      if (filters.triggerSource) p.set("triggerSource", filters.triggerSource);
      if (filters.recipient.trim()) p.set("recipient", filters.recipient.trim());
      if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
      if (filters.dateTo) p.set("dateTo", filters.dateTo);
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
  const filterKey = useMemo(() => buildParams(false).toString(), [buildParams]);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<DeliveryListResult>(`/comm-admin/deliveries?${listQuery}`));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError ? err.message : "Failed to load deliveries");
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

  const toggleSort = (col: Sort) => {
    if (sort === col) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(col);
      setOrder("desc");
    }
  };

  return (
    <section className="space-y-4">
      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            value={filters.q}
            onChange={(e) => patch({ q: e.target.value })}
            placeholder="Search recipient, template, subject…"
            aria-label="Search deliveries"
          />
          <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
          <Select value={filters.triggerSource} onChange={(e) => patch({ triggerSource: e.target.value })} aria-label="Trigger source">
            <option value="">All sources</option>
            {TRIGGER_SOURCES.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </Select>
          <Input
            value={filters.recipient}
            onChange={(e) => patch({ recipient: e.target.value })}
            placeholder="Recipient email"
            aria-label="Recipient"
          />
        </div>

        {showAdvanced && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input value={filters.template} onChange={(e) => patch({ template: e.target.value })} placeholder="Template key" aria-label="Template" />
            <Input value={filters.category} onChange={(e) => patch({ category: e.target.value })} placeholder="Category" aria-label="Category" />
            <Field label="Tenant UUID" error={filters.tenant && !isUuid(filters.tenant) ? "Enter a full UUID" : undefined}>
              <Input
                value={filters.tenant}
                onChange={(e) => patch({ tenant: e.target.value })}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </Field>
            <div />
            <Field label="Date from">
              <Input type="date" value={filters.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} />
            </Field>
            <Field label="Date to">
              <Input type="date" value={filters.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} />
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

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No deliveries match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3">Recipient</th>
                  <SortHeader label="Template" col="template" sort={sort} order={order} onSort={toggleSort} />
                  <SortHeader label="Source" col="triggerSource" sort={sort} order={order} onSort={toggleSort} />
                  <SortHeader label="Status" col="status" sort={sort} order={order} onSort={toggleSort} />
                  <th className="px-4 py-3">Tenant</th>
                  <SortHeader label="Created" col="createdAt" sort={sort} order={order} onSort={toggleSort} />
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => {
                  const isLegacy = d.source === "invoice";
                  const canRetry = d.status === "failed" && !isLegacy;
                  return (
                    <tr key={d.id} className="hover:bg-hover">
                      <td className="px-4 py-3">
                        <button onClick={() => setDetailId(d.id)} className="block text-left font-medium text-ink hover:text-brand-600">
                          {d.recipient}
                        </button>
                        {d.subject && (
                          <span className="block max-w-[16rem] truncate text-xs text-faint" title={d.subject}>
                            {d.subject}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">{d.template ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge tone="slate">{sourceLabel(d.triggerSource)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={deliveryStatusTone(d.status)}>{titleCase(d.status)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">{d.institutionName ?? "Platform"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-faint">{formatDateTime(d.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button variant="secondary" className="!px-2.5 !py-1.5" onClick={() => setDetailId(d.id)}>
                            View
                          </Button>
                          {canRetry && (
                            <Button variant="secondary" className="!px-2.5 !py-1.5" onClick={() => setRetryRow(d)}>
                              Retry
                            </Button>
                          )}
                          {d.status === "failed" && isLegacy && (
                            <span
                              className="inline-flex cursor-not-allowed items-center rounded-lg px-2.5 py-1.5 text-xs text-faint"
                              title="Legacy invoice deliveries are read-only and cannot be retried."
                            >
                              Read-only
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
            <Button variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next
              <Icon name="chevronRight" className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      <DeliveryDetailDrawer id={detailId} onClose={() => setDetailId(null)} onChanged={refresh} />

      <RetryDialog
        row={retryRow}
        onClose={() => setRetryRow(null)}
        onDone={() => {
          setRetryRow(null);
          refresh();
        }}
      />

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} params={buildParams(false)} />
    </section>
  );
}

// ---- sortable header -------------------------------------------------------

function SortHeader({
  label,
  col,
  sort,
  order,
  onSort,
}: {
  label: string;
  col: Sort;
  sort: Sort;
  order: "asc" | "desc";
  onSort: (col: Sort) => void;
}) {
  const active = sort === col;
  return (
    <th className="px-4 py-3">
      <button onClick={() => onSort(col)} className={`inline-flex items-center gap-1 uppercase ${active ? "text-ink" : "hover:text-ink"}`}>
        {label}
        {active && <Icon name={order === "asc" ? "trendUp" : "trendDown"} className="h-3.5 w-3.5" />}
      </button>
    </th>
  );
}

// ---- retry dialog ----------------------------------------------------------

function RetryDialog({
  row,
  onClose,
  onDone,
}: {
  row: DeliveryRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (row) {
      setReason("");
      setBusy(false);
      setError(null);
    }
  }, [row]);

  if (!row) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<DeliveryRetryResult>(
        `/comm-admin/deliveries/${row.id}/retry`,
        reason.trim() ? { reason: reason.trim() } : {}
      );
      toast.success(`Delivery re-sent (${res.status}).`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Retry failed");
      setBusy(false);
    }
  };

  return (
    <Modal open={row !== null} title="Retry delivery" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          This re-sends a fresh, append-only delivery to <span className="font-medium text-ink">{row.recipient}</span> (the
          original row is preserved). The action is audited.
        </p>
        <Field label="Reason (optional)">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why retry this delivery?" />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Retrying…" : "Retry delivery"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- export modal ----------------------------------------------------------

function ExportModal({ open, onClose, params }: { open: boolean; onClose: () => void; params: URLSearchParams }) {
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormat("csv");
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
      await downloadFile(`/comm-admin/deliveries/export?${p.toString()}`, `email-deliveries.${formatExt(format)}`);
      toast.success("Delivery log export downloaded.");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Export delivery log" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Every cell is masked (no secrets or secure links). A reason of at least 5 characters is required and recorded in
          the platform audit log. The current filters are applied.
        </div>
        <Field label="Format">
          <Select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")}>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </Select>
        </Field>
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
