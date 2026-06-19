"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { ApiError } from "@/lib/api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type {
  Invoice,
  InvoiceWithPayments,
  Paginated,
  PaymentOrder,
  StudentSummary,
} from "@/types";

async function downloadPortalPdf(path: string, filename: string) {
  const base =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const res = await fetch(`${base}${path}`, { credentials: "include" });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") msg = d.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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

  // "View payments" modal state.
  const [paymentsInvoice, setPaymentsInvoice] =
    useState<InvoiceWithPayments | null>(null);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  // "Pay online" per-row state.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [gatewayUnavailable, setGatewayUnavailable] = useState(false);

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

  const viewPayments = async (invoice: Invoice) => {
    setPaymentsOpen(true);
    setPaymentsInvoice(null);
    setPaymentsError(null);
    setReceiptError(null);
    setPaymentsLoading(true);
    try {
      setPaymentsInvoice(
        await portalApi.get<InvoiceWithPayments>(
          `/fees/invoices/${invoice.id}`
        )
      );
    } catch (err) {
      setPaymentsError(
        err instanceof ApiError ? err.message : "Failed to load payments"
      );
    } finally {
      setPaymentsLoading(false);
    }
  };

  const downloadReceipt = async (paymentId: string) => {
    setReceiptError(null);
    try {
      await downloadPortalPdf(
        `/fee-receipts/${paymentId}/download`,
        "receipt.pdf"
      );
    } catch (err) {
      setReceiptError(
        err instanceof ApiError ? err.message : "Failed to download receipt"
      );
    }
  };

  const payOnline = async (invoice: Invoice) => {
    setPayError(null);
    setGatewayUnavailable(false);
    setPayingId(invoice.id);
    try {
      const order = await portalApi.post<PaymentOrder>("/online-payments", {
        invoiceId: invoice.id,
      });
      if (order.checkoutUrl) {
        window.location.href = order.checkoutUrl;
        return; // leave the loading state on while navigating away
      }
      setPayError("Could not start the payment. Please try again.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setGatewayUnavailable(true);
      } else {
        setPayError(
          err instanceof ApiError ? err.message : "Failed to start payment"
        );
      }
    } finally {
      setPayingId(null);
    }
  };

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

      {gatewayUnavailable && (
        <Card className="mb-4 border-slate-200 bg-slate-50">
          <p className="text-sm text-slate-600">
            Online payment is not available right now. Please pay at the office
            or contact the school.
          </p>
        </Card>
      )}
      {payError && (
        <div className="mb-4">
          <ErrorNote message={payError} />
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
                <th className="px-4 py-3" />
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
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {(inv.status === "pending" ||
                        inv.status === "partially_paid") && (
                        <button
                          onClick={() => payOnline(inv)}
                          disabled={payingId === inv.id}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {payingId === inv.id ? "Starting…" : "Pay online"}
                        </button>
                      )}
                      <button
                        onClick={() => viewPayments(inv)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        View payments
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title={`Payments — ${paymentsInvoice?.invoiceNo ?? ""}`}
        open={paymentsOpen}
        onClose={() => setPaymentsOpen(false)}
      >
        {paymentsLoading ? (
          <Spinner />
        ) : paymentsError ? (
          <ErrorNote message={paymentsError} />
        ) : paymentsInvoice && paymentsInvoice.payments.length > 0 ? (
          <div className="space-y-3">
            <ErrorNote message={receiptError} />
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3">Paid</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paymentsInvoice.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-4 py-3 text-right text-slate-900">
                        {Number(payment.amount).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {payment.method.replace("_", " ")}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {payment.reference ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(payment.paidAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => downloadReceipt(payment.id)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Receipt
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState message="No payments recorded yet" />
        )}
      </Modal>
    </>
  );
}
