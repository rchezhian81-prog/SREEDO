"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Select,
  Spinner,
  cx,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { formatMoney } from "@/lib/format";
import { usePlatformGuard } from "../platform/_guard";
import { formatNumber } from "../platform/_utils";
import {
  SubscriptionActionModal,
  SUB_ACTIONS,
  type SubAction,
} from "./_modals";
import {
  addDaysISO,
  BILLING_CYCLES,
  downloadExport,
  INSTITUTION_TYPES,
  inGrace,
  PAYMENT_STATUSES,
  statusLabel,
  statusTone,
  SUB_STATUSES,
  todayISO,
  type LifecyclePreview,
  type PackageBrief,
  type Paged,
  type RunResult,
  type SubRow,
  type SubSummary,
} from "./_subs";

type SortKey =
  | "institution"
  | "package"
  | "status"
  | "start"
  | "expiry"
  | "renewal"
  | "outstanding";

interface Filters {
  status: string;
  packageId: string;
  institutionType: string;
  billingCycle: string;
  paymentStatus: string;
  startFrom: string;
  startTo: string;
  endFrom: string;
  endTo: string;
  renewFrom: string;
  renewTo: string;
  trialFrom: string;
  trialTo: string;
}

const EMPTY_FILTERS: Filters = {
  status: "",
  packageId: "",
  institutionType: "",
  billingCycle: "",
  paymentStatus: "",
  startFrom: "",
  startTo: "",
  endFrom: "",
  endTo: "",
  renewFrom: "",
  renewTo: "",
  trialFrom: "",
  trialTo: "",
};

const CHIPS: { key: string; label: string }[] = [
  { key: "trialing", label: "Trial" },
  { key: "active", label: "Active" },
  { key: "expiring", label: "Expiring soon" },
  { key: "grace", label: "Grace" },
  { key: "expired", label: "Expired" },
  { key: "suspended", label: "Suspended" },
  { key: "overdue", label: "Overdue" },
];

function CountCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber" | "red" | "green" | "blue";
}) {
  const color =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "green"
          ? "text-green-600 dark:text-green-400"
          : tone === "blue"
            ? "text-brand-600 dark:text-brand-300"
            : "text-ink";
  return (
    <Card className="min-w-[9rem] flex-1">
      <p className="text-xs uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{formatNumber(value)}</p>
    </Card>
  );
}

function MoneyCard({
  label,
  value,
  currency,
  tone,
}: {
  label: string;
  value: number;
  currency: string;
  tone?: "amber" | "red" | "green" | "blue";
}) {
  const color =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : tone === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "green"
          ? "text-green-600 dark:text-green-400"
          : tone === "blue"
            ? "text-brand-600 dark:text-brand-300"
            : "text-ink";
  return (
    <Card className="min-w-[9rem] flex-1">
      <p className="text-xs uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>
        {formatMoney(value, currency)}
      </p>
    </Card>
  );
}

/** Preview → confirm → run the lifecycle sweep, then report the result. */
function RunLifecycleModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<LifecyclePreview | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<LifecyclePreview>("/platform/subscriptions/lifecycle-preview")
      .then(setPreview)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to preview")
      )
      .finally(() => setLoading(false));
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api.post<RunResult>(
        "/platform/subscriptions/run-lifecycle"
      );
      setResult(r);
      toast.success("Lifecycle run complete");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to run");
    } finally {
      setRunning(false);
    }
  };

  const a = preview?.actions;
  return (
    <Modal title="Run lifecycle sweep" open onClose={onClose}>
      <div className="space-y-4">
        {loading ? (
          <Spinner />
        ) : result ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            <p className="font-semibold">Done</p>
            <p className="mt-1">
              grace started {result.graceStarted} · expired {result.expired} ·
              trials expired {result.trialExpired} · auto-suspended{" "}
              {result.autoSuspended} · reminders sent {result.remindersSent}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted">
              Dry-run preview of what running the sweep now would do:
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <PreviewRow label="Grace starting" value={a?.graceStarting} />
              <PreviewRow label="Trials expiring" value={a?.trialExpiring} />
              <PreviewRow label="Terms expiring" value={a?.termExpiring} />
              <PreviewRow label="Will expire" value={a?.willExpire} />
              <PreviewRow
                label="Will auto-suspend"
                value={a?.willAutoSuspend}
              />
              <PreviewRow
                label="Reminders to send"
                value={a?.remindersToSend}
              />
              <PreviewRow
                label="Overdue-billing risk"
                value={a?.overdueBillingRisk}
              />
            </div>
            {preview?.note && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {preview.note}
              </p>
            )}
          </>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={run} disabled={loading || running}>
              {running ? "Running…" : "Run lifecycle now"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PreviewRow({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{formatNumber(value ?? 0)}</span>
    </div>
  );
}

function RowMenu({
  open,
  onOpen,
  onClose,
  onAction,
  onView,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAction: (a: SubAction) => void;
  onView: () => void;
}) {
  return (
    <div className="relative inline-block text-left">
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (open) onClose();
          else onOpen();
        }}
        className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-muted hover:bg-hover hover:text-ink"
      >
        Actions ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onView();
                onClose();
              }}
              className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-hover"
            >
              View
            </button>
            {SUB_ACTIONS.map((x) => (
              <button
                key={x.action}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(x.action);
                  onClose();
                }}
                className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-hover"
              >
                {x.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function SubscriptionsPage() {
  const { ready, gate } = usePlatformGuard(
    "Subscriptions",
    "Tenant subscription lifecycle — dashboard, list & manual actions"
  );
  const router = useRouter();

  const [summary, setSummary] = useState<SubSummary | null>(null);
  const [data, setData] = useState<Paged<SubRow>>({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  const [packages, setPackages] = useState<PackageBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortKey>("institution");
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{
    action: SubAction;
    sub: SubRow;
  } | null>(null);
  const [showRun, setShowRun] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const setFilter = (k: keyof Filters, v: string) => {
    setFilters((s) => ({ ...s, [k]: v }));
    setActiveChip(null);
  };

  const applyChip = (key: string) => {
    if (activeChip === key) {
      setFilters(EMPTY_FILTERS);
      setActiveChip(null);
      return;
    }
    const next = { ...EMPTY_FILTERS };
    if (["trialing", "active", "expired", "suspended"].includes(key)) {
      next.status = key;
    } else if (key === "overdue") {
      next.paymentStatus = "overdue";
    } else if (key === "expiring") {
      next.endFrom = todayISO();
      next.endTo = addDaysISO(30);
    } else if (key === "grace") {
      // No single-param "grace" filter server-side; narrow to lapsed-term rows
      // (ends on/before today). The "in grace" row badge disambiguates.
      next.endTo = todayISO();
    }
    setFilters(next);
    setSearch("");
    setActiveChip(key);
  };

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    (Object.keys(filters) as (keyof Filters)[]).forEach((k) => {
      if (filters[k]) p.set(k, filters[k]);
    });
    if (debouncedSearch.trim()) p.set("q", debouncedSearch.trim());
    return p;
  }, [filters, debouncedSearch]);

  useEffect(() => {
    setPage(1);
  }, [filters, debouncedSearch, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = buildParams();
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      p.set("sort", sort);
      p.set("order", order);
      const list = await api.get<Paged<SubRow>>(
        `/platform/subscriptions/list?${p.toString()}`
      );
      setData(list);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load subscriptions"
      );
    } finally {
      setLoading(false);
    }
  }, [buildParams, page, pageSize, sort, order]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.get<SubSummary>("/platform/subscriptions/summary"));
    } catch {
      /* summary is best-effort */
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  useEffect(() => {
    if (!ready) return;
    loadSummary();
    api
      .get<PackageBrief[]>("/packages")
      .then(setPackages)
      .catch(() => setPackages([]));
  }, [ready, loadSummary]);

  const doExport = async (format: "csv" | "xlsx") => {
    const p = buildParams();
    p.set("sort", sort);
    p.set("order", order);
    p.set("format", format);
    try {
      await downloadExport(
        `/platform/subscriptions/export?${p.toString()}`,
        `subscriptions.${format}`
      );
    } catch {
      toast.error("Export failed");
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder("asc");
    }
  };

  const SortTh = ({ label, k }: { label: string; k: SortKey }) => (
    <th className="px-4 py-3">
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 uppercase hover:text-ink"
      >
        {label}
        {sort === k && <span>{order === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 25)));
  const hasFilters = useMemo(
    () => !!debouncedSearch || Object.values(filters).some(Boolean),
    [debouncedSearch, filters]
  );

  if (!ready) return gate;

  return (
    <>
      <PageHeader
        title="Subscriptions"
        subtitle="Tenant subscription lifecycle — dashboard, list & manual actions"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push("/super-admin/subscriptions/calendar")}
            >
              Renewal calendar
            </Button>
            <Button
              variant="secondary"
              onClick={() => router.push("/super-admin/subscriptions/reports")}
            >
              Reports
            </Button>
            <Button
              variant="secondary"
              onClick={() => router.push("/super-admin/subscriptions/config")}
            >
              Config
            </Button>
            <Button onClick={() => setShowRun(true)}>Run lifecycle</Button>
          </div>
        }
      />

      {/* Summary — status counts */}
      {summary && (
        <>
          <div className="mb-3 flex flex-wrap gap-3">
            <CountCard label="Total" value={summary.counts.total} />
            <CountCard
              label="Active"
              value={summary.counts.active}
              tone="green"
            />
            <CountCard
              label="Trial"
              value={summary.counts.trialing}
              tone="blue"
            />
            <CountCard
              label="Expiring soon"
              value={summary.counts.expiringSoon}
              tone="amber"
            />
            <CountCard label="Grace" value={summary.counts.grace} tone="amber" />
            <CountCard label="Expired" value={summary.counts.expired} />
            <CountCard
              label="Suspended"
              value={summary.counts.suspended}
              tone="red"
            />
            <CountCard label="Cancelled" value={summary.counts.cancelled} />
            <CountCard
              label="Overdue billing"
              value={summary.counts.overdueBilling}
              tone="red"
            />
          </div>
          <div className="mb-3 flex flex-wrap gap-3">
            <MoneyCard
              label="MRR"
              value={summary.revenue.mrr}
              currency={summary.revenue.currency}
              tone="green"
            />
            <MoneyCard
              label="ARR"
              value={summary.revenue.arr}
              currency={summary.revenue.currency}
              tone="green"
            />
            <MoneyCard
              label="Outstanding"
              value={summary.revenue.outstanding}
              currency={summary.revenue.currency}
              tone="blue"
            />
            <MoneyCard
              label="Overdue"
              value={summary.revenue.overdue}
              currency={summary.revenue.currency}
              tone="red"
            />
          </div>
          {summary.revenue.mixedCurrency && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              <Badge tone="amber">note</Badge>
              <span>
                Multiple currencies in use — revenue figures shown in{" "}
                <strong>{summary.revenue.currency}</strong>.
              </span>
            </div>
          )}
        </>
      )}

      {/* Quick-filter chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => applyChip(c.key)}
            className={cx(
              "rounded-full border px-3 py-1 text-xs font-semibold transition",
              activeChip === c.key
                ? "border-brand-500 bg-brand-500/12 text-brand-600 dark:text-brand-300"
                : "border-line text-muted hover:bg-hover hover:text-ink"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Search
          </label>
          <input
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="Institution, code or package…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Status
          </label>
          <Select
            value={filters.status}
            onChange={(e) => setFilter("status", e.target.value)}
          >
            <option value="">All statuses</option>
            {SUB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Package
          </label>
          <Select
            value={filters.packageId}
            onChange={(e) => setFilter("packageId", e.target.value)}
          >
            <option value="">All packages</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Type
          </label>
          <Select
            value={filters.institutionType}
            onChange={(e) => setFilter("institutionType", e.target.value)}
          >
            <option value="">All types</option>
            {INSTITUTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="secondary" onClick={() => setShowAdvanced((s) => !s)}>
          {showAdvanced ? "Hide filters" : "More filters"}
        </Button>
        <Button variant="secondary" onClick={() => doExport("csv")}>
          Export CSV
        </Button>
        <Button variant="secondary" onClick={() => doExport("xlsx")}>
          Export Excel
        </Button>
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setSearch("");
              setActiveChip(null);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {showAdvanced && (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Billing cycle
            </label>
            <Select
              value={filters.billingCycle}
              onChange={(e) => setFilter("billingCycle", e.target.value)}
            >
              <option value="">Any</option>
              {BILLING_CYCLES.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ")}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">
              Payment status
            </label>
            <Select
              value={filters.paymentStatus}
              onChange={(e) => setFilter("paymentStatus", e.target.value)}
            >
              <option value="">Any</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <DateFilter
            label="Start from"
            value={filters.startFrom}
            onChange={(v) => setFilter("startFrom", v)}
          />
          <DateFilter
            label="Start to"
            value={filters.startTo}
            onChange={(v) => setFilter("startTo", v)}
          />
          <DateFilter
            label="Expiry from"
            value={filters.endFrom}
            onChange={(v) => setFilter("endFrom", v)}
          />
          <DateFilter
            label="Expiry to"
            value={filters.endTo}
            onChange={(v) => setFilter("endTo", v)}
          />
          <DateFilter
            label="Renewal from"
            value={filters.renewFrom}
            onChange={(v) => setFilter("renewFrom", v)}
          />
          <DateFilter
            label="Renewal to"
            value={filters.renewTo}
            onChange={(v) => setFilter("renewTo", v)}
          />
          <DateFilter
            label="Trial ends from"
            value={filters.trialFrom}
            onChange={(v) => setFilter("trialFrom", v)}
          />
          <DateFilter
            label="Trial ends to"
            value={filters.trialTo}
            onChange={(v) => setFilter("trialTo", v)}
          />
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : data.rows.length === 0 ? (
        <EmptyState
          message={
            hasFilters
              ? "No subscriptions match these filters"
              : "No subscriptions yet"
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <SortTh label="Institution" k="institution" />
                  <SortTh label="Package" k="package" />
                  <SortTh label="Status" k="status" />
                  <SortTh label="Start" k="start" />
                  <SortTh label="Expiry" k="expiry" />
                  <SortTh label="Renewal" k="renewal" />
                  <SortTh label="Outstanding" k="outstanding" />
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-surface-2"
                    onClick={() =>
                      router.push(`/super-admin/subscriptions/${r.id}`)
                    }
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/super-admin/subscriptions/${r.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-ink hover:text-brand-600"
                      >
                        {r.institutionName}
                      </Link>
                      <span className="block text-xs text-faint">
                        {r.institutionCode} · {r.institutionType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {r.packageName ?? "—"}
                      <span className="block text-xs text-faint">
                        {r.billingCycle}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone={statusTone(r.status)}>
                          {statusLabel(r.status)}
                        </Badge>
                        {inGrace(r) && <Badge tone="amber">grace</Badge>}
                        {!r.institutionActive && (
                          <Badge tone="red">locked</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{r.startsAt ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{r.endsAt ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{r.renewsAt ?? "—"}</td>
                    <td className="px-4 py-3 text-ink">
                      {formatMoney(r.outstanding, r.currency)}
                      {r.overdue > 0 && (
                        <span className="ml-1 text-xs text-red-500">
                          ({formatMoney(r.overdue, r.currency)} overdue)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={r.isActiveNow ? "green" : "slate"}>
                        {r.isActiveNow ? "yes" : "no"}
                      </Badge>
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <RowMenu
                        open={openMenu === r.id}
                        onOpen={() => setOpenMenu(r.id)}
                        onClose={() => setOpenMenu(null)}
                        onView={() =>
                          router.push(`/super-admin/subscriptions/${r.id}`)
                        }
                        onAction={(action) =>
                          setActionModal({ action, sub: r })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <div className="flex items-center gap-2">
              <span>
                {data.total} subscription{data.total === 1 ? "" : "s"}
              </span>
              <Select
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="w-28"
              >
                <option value="10">10 / page</option>
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                ← Prev
              </Button>
              <span>
                Page {data.page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
              >
                Next →
              </Button>
            </div>
          </div>
        </>
      )}

      <SubscriptionActionModal
        action={actionModal?.action ?? null}
        subId={actionModal?.sub.id ?? null}
        packages={packages}
        currentPackageId={actionModal?.sub.packageId}
        onClose={() => setActionModal(null)}
        onSuccess={() => {
          load();
          loadSummary();
        }}
      />

      {showRun && (
        <RunLifecycleModal
          onClose={() => setShowRun(false)}
          onDone={() => {
            load();
            loadSummary();
          }}
        />
      )}
    </>
  );
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        type="date"
        className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
