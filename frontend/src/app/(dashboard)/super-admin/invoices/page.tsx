"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { formatDate, formatMoney } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

interface InvoiceRow {
  id: string;
  institutionName: string;
  institutionCode: string;
  number: string | null;
  status: string;
  currency: string;
  total: string;
  dueDate: string | null;
  isOverdue: boolean;
  createdAt: string;
}

interface Paged {
  rows: InvoiceRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface Summary {
  draftCount: number;
  issuedCount: number;
  paidCount: number;
  voidCount: number;
  outstandingAmount: string;
  paidAmount: string;
  overdueCount: number;
  overdueAmount: string;
}

interface InstitutionBrief {
  id: string;
  name: string;
  code: string;
}

interface PackageBrief {
  id: string;
  name: string;
}

interface DraftLine {
  description: string;
  quantity: string;
  unitPrice: string;
}

type Tone = "slate" | "green" | "amber" | "red" | "blue";
const statusTone = (s: string): Tone =>
  s === "paid" ? "green" : s === "issued" ? "blue" : s === "void" ? "slate" : "amber";

type SortKey = "createdAt" | "dueDate" | "total" | "number" | "status";

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "red" | "green" | "blue";
}) {
  const valueColor =
    tone === "red"
      ? "text-red-600 dark:text-red-400"
      : tone === "green"
        ? "text-green-600 dark:text-green-400"
        : tone === "blue"
          ? "text-brand-600 dark:text-brand-300"
          : "text-ink";
  return (
    <Card className="flex-1">
      <p className="text-xs uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

export default function InvoicesPage() {
  const router = useRouter();
  const [data, setData] = useState<Paged>({ rows: [], total: 0, page: 1, pageSize: 20 });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters + paging + sort.
  const [statusFilter, setStatusFilter] = useState("");
  const [institutionFilter, setInstitutionFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  // Advanced filters (backend-supported).
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [adv, setAdv] = useState({
    dueFrom: "",
    dueTo: "",
    amountMin: "",
    amountMax: "",
    sacCode: "",
    gstin: "",
    placeOfSupply: "",
    recipientState: "",
    reverseCharge: "", // "", "true", "false"
  });
  const setAdvField = (k: keyof typeof adv, v: string) => setAdv((a) => ({ ...a, [k]: v }));

  // Create-modal state.
  const [open, setOpen] = useState(false);
  const [institutions, setInstitutions] = useState<InstitutionBrief[]>([]);
  const [packages, setPackages] = useState<PackageBrief[]>([]);
  const [form, setForm] = useState({
    institutionId: "",
    packageId: "",
    currency: "INR",
    taxPercent: "0",
    paymentTermsDays: "",
    dueDate: "",
    billingName: "",
    gstin: "",
    billingAddress: "",
    periodStart: "",
    periodEnd: "",
    sacCode: "",
    placeOfSupply: "",
    recipientState: "",
    recipientStateCode: "",
    reverseCharge: false,
    notes: "",
  });
  const [lines, setLines] = useState<DraftLine[]>([
    { description: "", quantity: "1", unitPrice: "0" },
  ]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Debounce the free-text search so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Shared filter → query params (used by the list load AND the export).
  const buildFilterParams = useCallback(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set("status", statusFilter);
    if (institutionFilter) p.set("institutionId", institutionFilter);
    if (overdueOnly) p.set("overdue", "true");
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (debouncedSearch.trim()) p.set("q", debouncedSearch.trim());
    if (adv.dueFrom) p.set("dueFrom", adv.dueFrom);
    if (adv.dueTo) p.set("dueTo", adv.dueTo);
    if (adv.amountMin) p.set("amountMin", adv.amountMin);
    if (adv.amountMax) p.set("amountMax", adv.amountMax);
    if (adv.sacCode.trim()) p.set("sacCode", adv.sacCode.trim());
    if (adv.gstin.trim()) p.set("gstin", adv.gstin.trim());
    if (adv.placeOfSupply.trim()) p.set("placeOfSupply", adv.placeOfSupply.trim());
    if (adv.recipientState.trim()) p.set("recipientState", adv.recipientState.trim());
    if (adv.reverseCharge) p.set("reverseCharge", adv.reverseCharge);
    return p;
  }, [statusFilter, institutionFilter, overdueOnly, from, to, debouncedSearch, adv]);

  // Any filter change resets to page 1.
  useEffect(() => {
    setPage(1);
  }, [statusFilter, institutionFilter, overdueOnly, from, to, debouncedSearch, pageSize, adv]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = buildFilterParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("sort", sort);
      params.set("order", order);
      const [list, sum] = await Promise.all([
        api.get<Paged>(`/platform/invoices?${params.toString()}`),
        api.get<Summary>("/platform/invoices/summary").catch(() => null),
      ]);
      setData(list);
      if (sum) setSummary(sum);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [buildFilterParams, page, pageSize, sort, order]);

  const exportList = async (format: "csv" | "xlsx") => {
    const params = buildFilterParams();
    params.set("sort", sort);
    params.set("order", order);
    params.set("format", format);
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${API_URL}/platform/invoices/export?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError("Export failed");
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `invoices.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  };

  useEffect(() => {
    load();
  }, [load]);

  // Institutions power both the filter dropdown and the create form.
  useEffect(() => {
    api
      .get<InstitutionBrief[]>("/platform/institutions")
      .then(setInstitutions)
      .catch(() => {
        /* best-effort */
      });
  }, []);

  const openCreate = async () => {
    setFormError(null);
    setOpen(true);
    if (packages.length === 0) {
      try {
        setPackages(await api.get<PackageBrief[]>("/packages"));
      } catch {
        /* package list is optional for the picker */
      }
    }
  };

  const setLine = (i: number, key: keyof DraftLine, value: string) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));

  const create = async () => {
    setFormError(null);
    if (!form.institutionId) {
      setFormError("Select an institution");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        packageId: form.packageId || undefined,
        currency: form.currency || undefined,
        taxPercent: Number(form.taxPercent) || 0,
        paymentTermsDays: form.paymentTermsDays
          ? Number(form.paymentTermsDays)
          : undefined,
        dueDate: form.dueDate || undefined,
        gstin: form.gstin || undefined,
        billingName: form.billingName || undefined,
        billingAddress: form.billingAddress || undefined,
        periodStart: form.periodStart || undefined,
        periodEnd: form.periodEnd || undefined,
        sacCode: form.sacCode || undefined,
        placeOfSupply: form.placeOfSupply || undefined,
        reverseCharge: form.reverseCharge || undefined,
        recipientState: form.recipientState || undefined,
        recipientStateCode: form.recipientStateCode || undefined,
        notes: form.notes || undefined,
        lines: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            description: l.description,
            quantity: Number(l.quantity) || 0,
            unitPrice: Number(l.unitPrice) || 0,
          })),
      };
      const created = await api.post<{ id: string }>(
        `/platform/institutions/${form.institutionId}/invoices`,
        payload
      );
      setOpen(false);
      router.push(`/super-admin/invoices/${created.id}`);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to create invoice"
      );
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async (id: string) => {
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${API_URL}/platform/invoices/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setOrder("desc");
    }
  };

  const SortTh = ({ label, sortKey }: { label: string; sortKey: SortKey }) => (
    <th className="px-4 py-3">
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase hover:text-ink"
      >
        {label}
        {sort === sortKey && <span>{order === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="SaaS subscription invoices (gateway-free, offline payment) — super-admin"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => router.push("/super-admin/invoices/reports")}>
              Reports
            </Button>
            <Button variant="secondary" onClick={() => router.push("/super-admin/invoices/settings")}>
              Settings
            </Button>
            <Button onClick={openCreate}>+ New invoice</Button>
          </div>
        }
      />

      {summary && (
        <div className="mb-4 flex flex-wrap gap-3">
          <StatCard
            label="Outstanding"
            value={formatMoney(summary.outstandingAmount)}
            sub={`${summary.issuedCount} issued`}
            tone="blue"
          />
          <StatCard
            label="Overdue"
            value={formatMoney(summary.overdueAmount)}
            sub={`${summary.overdueCount} past due`}
            tone="red"
          />
          <StatCard
            label="Paid"
            value={formatMoney(summary.paidAmount)}
            sub={`${summary.paidCount} settled`}
            tone="green"
          />
          <StatCard label="Drafts" value={String(summary.draftCount)} sub="not issued" />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="paid">Paid</option>
              <option value="void">Void</option>
            </Select>
          </Field>
        </div>
        <div className="w-52">
          <Field label="Institution">
            <Select
              value={institutionFilter}
              onChange={(e) => setInstitutionFilter(e.target.value)}
            >
              <option value="">All institutions</option>
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.code})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-36">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div className="w-36">
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="min-w-[12rem] flex-1">
          <Field label="Search">
            <Input
              placeholder="Institution or invoice no…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          Overdue only
        </label>
        <Button variant="secondary" onClick={() => setShowAdvanced((s) => !s)}>
          {showAdvanced ? "Hide filters" : "Advanced filters"}
        </Button>
        <Button variant="secondary" onClick={() => exportList("csv")}>
          Export CSV
        </Button>
        <Button variant="secondary" onClick={() => exportList("xlsx")}>
          Export Excel
        </Button>
      </div>

      {showAdvanced && (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-4">
          <Field label="Due from">
            <Input type="date" value={adv.dueFrom} onChange={(e) => setAdvField("dueFrom", e.target.value)} />
          </Field>
          <Field label="Due to">
            <Input type="date" value={adv.dueTo} onChange={(e) => setAdvField("dueTo", e.target.value)} />
          </Field>
          <Field label="Amount min">
            <Input type="number" value={adv.amountMin} onChange={(e) => setAdvField("amountMin", e.target.value)} />
          </Field>
          <Field label="Amount max">
            <Input type="number" value={adv.amountMax} onChange={(e) => setAdvField("amountMax", e.target.value)} />
          </Field>
          <Field label="SAC/HSN">
            <Input value={adv.sacCode} onChange={(e) => setAdvField("sacCode", e.target.value)} />
          </Field>
          <Field label="GSTIN">
            <Input value={adv.gstin} onChange={(e) => setAdvField("gstin", e.target.value)} />
          </Field>
          <Field label="Place of supply">
            <Input value={adv.placeOfSupply} onChange={(e) => setAdvField("placeOfSupply", e.target.value)} />
          </Field>
          <Field label="Recipient state">
            <Input value={adv.recipientState} onChange={(e) => setAdvField("recipientState", e.target.value)} />
          </Field>
          <Field label="Reverse charge">
            <Select value={adv.reverseCharge} onChange={(e) => setAdvField("reverseCharge", e.target.value)}>
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </Field>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : data.rows.length === 0 ? (
        <EmptyState message="No invoices match these filters" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <SortTh label="Number" sortKey="number" />
                  <th className="px-4 py-3">Institution</th>
                  <SortTh label="Status" sortKey="status" />
                  <SortTh label="Due" sortKey="dueDate" />
                  <SortTh label="Total" sortKey="total" />
                  <SortTh label="Created" sortKey="createdAt" />
                  <th className="px-4 py-3 text-right">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-surface-2"
                    onClick={() => router.push(`/super-admin/invoices/${r.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-ink">
                      {r.number ?? <span className="text-faint">draft</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.institutionName}
                      <span className="block text-xs text-faint">{r.institutionCode}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                        {r.isOverdue && <Badge tone="red">overdue</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {r.dueDate ? (
                        <span className={r.isOverdue ? "text-red-600 dark:text-red-400" : ""}>
                          {formatDate(r.dueDate)}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink">{formatMoney(r.total, r.currency)}</td>
                    <td className="px-4 py-3 text-faint">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadPdf(r.id);
                        }}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
                        aria-label="Download PDF"
                      >
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <div className="flex items-center gap-2">
              <span>
                {data.total} invoice{data.total === 1 ? "" : "s"}
              </span>
              <Select
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="w-24"
              >
                <option value="10">10 / page</option>
                <option value="20">20 / page</option>
                <option value="50">50 / page</option>
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

      <Modal title="New invoice (draft)" open={open} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <Field label="Institution">
            <Select
              value={form.institutionId}
              onChange={(e) => setForm({ ...form, institutionId: e.target.value })}
            >
              <option value="">Select an institution…</option>
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Package (optional)">
            <Select
              value={form.packageId}
              onChange={(e) => setForm({ ...form, packageId: e.target.value })}
            >
              <option value="">No package</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency">
              <Input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              />
            </Field>
            <Field label="Tax %">
              <Input
                type="number"
                value={form.taxPercent}
                onChange={(e) => setForm({ ...form, taxPercent: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment terms (days, optional)">
              <Input
                type="number"
                placeholder="e.g. 15"
                value={form.paymentTermsDays}
                onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })}
              />
            </Field>
            <Field label="Due date (optional)">
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Period start (optional)">
              <Input
                type="date"
                value={form.periodStart}
                onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
              />
            </Field>
            <Field label="Period end (optional)">
              <Input
                type="date"
                value={form.periodEnd}
                onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Billing name (optional)">
              <Input
                value={form.billingName}
                onChange={(e) => setForm({ ...form, billingName: e.target.value })}
              />
            </Field>
            <Field label="GSTIN (optional)">
              <Input
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Billing address (optional)">
            <Textarea
              rows={2}
              value={form.billingAddress}
              onChange={(e) => setForm({ ...form, billingAddress: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="SAC/HSN (optional)">
              <Input
                value={form.sacCode}
                onChange={(e) => setForm({ ...form, sacCode: e.target.value })}
              />
            </Field>
            <Field label="Place of supply (optional)">
              <Input
                value={form.placeOfSupply}
                onChange={(e) => setForm({ ...form, placeOfSupply: e.target.value })}
              />
            </Field>
            <Field label="Recipient state (optional)">
              <Input
                value={form.recipientState}
                onChange={(e) => setForm({ ...form, recipientState: e.target.value })}
              />
            </Field>
            <Field label="Recipient state code (optional)">
              <Input
                value={form.recipientStateCode}
                onChange={(e) => setForm({ ...form, recipientStateCode: e.target.value })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={form.reverseCharge}
              onChange={(e) => setForm({ ...form, reverseCharge: e.target.checked })}
              className="h-4 w-4 rounded border-line"
            />
            Reverse charge applicable
          </label>

          <div>
            <p className="mb-2 text-sm font-medium text-ink">Line items</p>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <div className="col-span-6">
                    <Input
                      placeholder="Description"
                      value={l.description}
                      onChange={(e) => setLine(i, "description", e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      placeholder="Qty"
                      value={l.quantity}
                      onChange={(e) => setLine(i, "quantity", e.target.value)}
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      type="number"
                      placeholder="Unit price"
                      value={l.unitPrice}
                      onChange={(e) => setLine(i, "unitPrice", e.target.value)}
                    />
                  </div>
                  <div className="col-span-1 flex items-center">
                    <button
                      type="button"
                      onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                      className="text-xs text-red-600 hover:text-red-700"
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setLines((p) => [...p, { description: "", quantity: "1", unitPrice: "0" }])
              }
              className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
            >
              + Add line
            </button>
          </div>

          <Field label="Notes (optional)">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>

          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={saving}>
              {saving ? "Creating…" : "Create draft"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
