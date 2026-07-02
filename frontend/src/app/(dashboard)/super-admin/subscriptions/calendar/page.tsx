"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { formatDate } from "@/lib/format";
import { usePlatformGuard } from "../../platform/_guard";
import {
  downloadExport,
  INSTITUTION_TYPES,
  statusTone,
  SUB_STATUSES,
  type CalendarRow,
  type PackageBrief,
  type Tone,
} from "../_subs";

const KIND_LABEL: Record<string, string> = {
  renewal: "Renewal",
  expiry: "Expiry",
  trial_end: "Trial end",
  grace_end: "Grace end",
};
const KIND_TONE: Record<string, Tone> = {
  renewal: "blue",
  expiry: "red",
  trial_end: "amber",
  grace_end: "amber",
};

export default function RenewalCalendarPage() {
  const { ready, gate } = usePlatformGuard(
    "Renewal calendar",
    "Upcoming renewals, expiries, trial & grace ends"
  );

  const [rows, setRows] = useState<CalendarRow[]>([]);
  const [packages, setPackages] = useState<PackageBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    from: "",
    to: "",
    status: "",
    packageId: "",
    institutionType: "",
  });
  const setFilter = (k: keyof typeof filters, v: string) =>
    setFilters((s) => ({ ...s, [k]: v }));

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    if (filters.status) p.set("status", filters.status);
    if (filters.packageId) p.set("packageId", filters.packageId);
    if (filters.institutionType)
      p.set("institutionType", filters.institutionType);
    return p;
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = buildParams();
      setRows(
        await api.get<CalendarRow[]>(
          `/platform/subscriptions/calendar?${p.toString()}`
        )
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  useEffect(() => {
    if (!ready) return;
    api
      .get<PackageBrief[]>("/packages")
      .then(setPackages)
      .catch(() => setPackages([]));
  }, [ready]);

  const doExport = async (format: "csv" | "xlsx") => {
    const p = buildParams();
    p.set("format", format);
    try {
      await downloadExport(
        `/platform/subscriptions/calendar?${p.toString()}`,
        `renewal-calendar.${format}`
      );
    } catch {
      toast.error("Export failed");
    }
  };

  if (!ready) return gate;

  // Group rows by date (already sorted by date ASC from the backend).
  const groups: { date: string; items: CalendarRow[] }[] = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.date === r.date) g.items.push(r);
    else groups.push({ date: r.date, items: [r] });
  }

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/subscriptions" className="hover:text-muted">
          Subscriptions
        </Link>{" "}
        / <span className="text-muted">Renewal calendar</span>
      </nav>
      <PageHeader
        title="Renewal calendar"
        subtitle="Upcoming renewals, expiries, trial & grace ends"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => doExport("csv")}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={() => doExport("xlsx")}>
              Export Excel
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            From
          </label>
          <input
            type="date"
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            value={filters.from}
            onChange={(e) => setFilter("from", e.target.value)}
          />
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-sm font-medium text-ink">
            To
          </label>
          <input
            type="date"
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            value={filters.to}
            onChange={(e) => setFilter("to", e.target.value)}
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
                {s === "trialing" ? "trial" : s}
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
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : groups.length === 0 ? (
        <EmptyState message="No calendar events in this window" />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.date}>
              <p className="mb-3 text-sm font-semibold text-ink">
                {formatDate(g.date)}
              </p>
              <ul className="divide-y divide-line">
                {g.items.map((r) => (
                  <li
                    key={`${r.subscriptionId}-${r.kind}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={KIND_TONE[r.kind] ?? "slate"}>
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </Badge>
                      <Link
                        href={`/super-admin/subscriptions/${r.subscriptionId}`}
                        className="font-medium text-ink hover:text-brand-600"
                      >
                        {r.institutionName}
                      </Link>
                      <span className="text-xs text-faint">
                        {r.institutionCode} · {r.packageName}
                      </span>
                    </div>
                    <Badge tone={statusTone(r.status)}>
                      {r.status === "trialing" ? "trial" : r.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
