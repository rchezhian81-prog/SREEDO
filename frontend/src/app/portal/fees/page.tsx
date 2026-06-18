"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Badge,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { Invoice, Paginated, StudentSummary } from "@/types";

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

const STATUS_TONES: Record<
  Invoice["status"],
  "green" | "amber" | "red" | "slate"
> = {
  paid: "green",
  partially_paid: "amber",
  pending: "red",
  cancelled: "slate",
};

export default function PortalFeesPage() {
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const [summary, setSummary] = useState<StudentSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) {
      setSummary(null);
      setInvoices(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setInvoices(null);

    portalApi
      .get<StudentSummary>(`/portal/students/${studentId}/summary`)
      .then(setSummary)
      .catch(() => setError("Could not load fee details."))
      .finally(() => setLoading(false));

    // Optional invoice list — skip silently if the endpoint errors.
    portalApi
      .get<Paginated<Invoice>>(`/fees/invoices?studentId=${studentId}`)
      .then((res) => setInvoices(res.data))
      .catch(() => setInvoices(null));
  }, [studentId]);

  if (!studentId) {
    return (
      <>
        <PageHeader title="Fees" />
        <EmptyState message="No student linked to your account yet." />
      </>
    );
  }

  if (loading) return <Spinner />;

  const f = summary?.fees;

  return (
    <>
      <PageHeader title="Fees" subtitle="Invoices and payments" />
      <ErrorNote message={error} />
      {f && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total due" value={f.totalDue.toLocaleString()} />
          <StatCard label="Total paid" value={f.totalPaid.toLocaleString()} />
          <StatCard
            label="Outstanding"
            value={f.outstanding.toLocaleString()}
          />
          <StatCard label="Pending invoices" value={f.pendingInvoices} />
        </div>
      )}

      {invoices && invoices.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Due</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {inv.invoiceNo}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {inv.description}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-900">
                    {Number(inv.amountDue).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-900">
                    {Number(inv.amountPaid).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONES[inv.status]}>
                      {inv.status.replace("_", " ")}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
