"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
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

interface InvoiceRow {
  id: string;
  institutionName: string;
  institutionCode: string;
  number: string | null;
  status: string;
  currency: string;
  total: string;
  createdAt: string;
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

export default function InvoicesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const [open, setOpen] = useState(false);
  const [institutions, setInstitutions] = useState<InstitutionBrief[]>([]);
  const [packages, setPackages] = useState<PackageBrief[]>([]);
  const [form, setForm] = useState({
    institutionId: "",
    packageId: "",
    currency: "INR",
    taxPercent: "0",
    billingName: "",
    gstin: "",
    billingAddress: "",
    periodStart: "",
    periodEnd: "",
    notes: "",
  });
  const [lines, setLines] = useState<DraftLine[]>([
    { description: "", quantity: "1", unitPrice: "0" },
  ]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = statusFilter ? `?status=${statusFilter}` : "";
      setRows(await api.get<InvoiceRow[]>(`/platform/invoices${q}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = async () => {
    setFormError(null);
    setOpen(true);
    if (institutions.length === 0) {
      try {
        setInstitutions(
          await api.get<InstitutionBrief[]>("/platform/institutions")
        );
      } catch {
        /* institution list is best-effort for the picker */
      }
    }
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
        gstin: form.gstin || undefined,
        billingName: form.billingName || undefined,
        billingAddress: form.billingAddress || undefined,
        periodStart: form.periodStart || undefined,
        periodEnd: form.periodEnd || undefined,
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

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="SaaS subscription invoices (gateway-free, offline payment) — super-admin"
        action={<Button onClick={openCreate}>+ New invoice</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-44">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </Select>
        </div>
        <div className="max-w-xs flex-1">
          <Input
            placeholder="Search institution or invoice no…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : rows.length === 0 ? (
        <EmptyState message="No invoices yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Institution</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows
                .filter((r) => {
                  const q = search.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    r.institutionName.toLowerCase().includes(q) ||
                    r.institutionCode.toLowerCase().includes(q) ||
                    (r.number ?? "").toLowerCase().includes(q)
                  );
                })
                .map((r) => (
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
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {r.currency} {Number(r.total).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-faint">{r.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                      onClick={() =>
                        setLines((p) => p.filter((_, idx) => idx !== i))
                      }
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
