"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

interface Line {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}
interface Invoice {
  id: string;
  institutionId: string;
  number: string | null;
  status: string;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  subtotal: string;
  taxPercent: string;
  taxAmount: string;
  total: string;
  gstin: string | null;
  billingName: string | null;
  billingAddress: string | null;
  taxNotes: string | null;
  notes: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  lines: Line[];
}

type Tone = "slate" | "green" | "amber" | "red" | "blue";
const statusTone = (s: string): Tone =>
  s === "paid" ? "green" : s === "issued" ? "blue" : s === "void" ? "slate" : "amber";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newLine, setNewLine] = useState({ description: "", quantity: "1", unitPrice: "0" });
  const [payMethod, setPayMethod] = useState("bank_transfer");
  const [payRef, setPayRef] = useState("");

  const money = (v: string | number) => `${inv?.currency ?? ""} ${Number(v).toFixed(2)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInv(await api.get<Invoice>(`/platform/invoices/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const addLine = () =>
    act(async () => {
      await api.post(`/platform/invoices/${id}/lines`, {
        description: newLine.description,
        quantity: Number(newLine.quantity) || 0,
        unitPrice: Number(newLine.unitPrice) || 0,
      });
      setNewLine({ description: "", quantity: "1", unitPrice: "0" });
    });

  const issue = () => act(() => api.post(`/platform/invoices/${id}/issue`));
  const markPaid = () =>
    act(() =>
      api.post(`/platform/invoices/${id}/mark-paid`, {
        paymentMethod: payMethod,
        reference: payRef || undefined,
      })
    );
  const voidInvoice = () =>
    act(() => api.post(`/platform/invoices/${id}/void`));

  const downloadPdf = async () => {
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${API_URL}/platform/invoices/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      setError("Failed to download PDF");
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (loading) return <Spinner />;
  if (error && !inv) return <ErrorNote message={error} />;
  if (!inv) return <ErrorNote message="Invoice not found" />;

  return (
    <>
      <PageHeader
        title={inv.number ?? "Draft invoice"}
        subtitle="SaaS subscription invoice"
        action={
          <Button variant="secondary" onClick={() => router.push("/super-admin/invoices")}>
            ← Back
          </Button>
        }
      />

      {error && <ErrorNote message={error} />}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
          {inv.issuedAt && (
            <span className="text-xs text-muted">Issued {inv.issuedAt.slice(0, 10)}</span>
          )}
          {inv.status === "paid" && inv.paidAt && (
            <span className="text-xs text-muted">
              Paid {inv.paidAt.slice(0, 10)}
              {inv.paymentMethod ? ` · ${inv.paymentMethod}` : ""}
              {inv.paymentReference ? ` · ${inv.paymentReference}` : ""}
            </span>
          )}
        </div>
        {(inv.billingName || inv.billingAddress || inv.gstin) && (
          <div className="mt-3 text-sm text-muted">
            {inv.billingName && <div className="text-ink">{inv.billingName}</div>}
            {inv.billingAddress && <div>{inv.billingAddress}</div>}
            {inv.gstin && <div>GSTIN: {inv.gstin}</div>}
          </div>
        )}
      </Card>

      <Card className="mb-4">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-2">Description</th>
              <th className="py-2">Qty</th>
              <th className="py-2">Unit</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2 text-ink">{l.description}</td>
                <td className="py-2 text-muted">{Number(l.quantity)}</td>
                <td className="py-2 text-muted">{money(l.unitPrice)}</td>
                <td className="py-2 text-right text-ink">{money(l.amount)}</td>
              </tr>
            ))}
            {inv.lines.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-faint">
                  No line items yet
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
          <div className="flex justify-between text-muted">
            <span>Subtotal</span>
            <span>{money(inv.subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Tax ({Number(inv.taxPercent).toFixed(2)}%)</span>
            <span>{money(inv.taxAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-1 font-semibold text-ink">
            <span>Total</span>
            <span>{money(inv.total)}</span>
          </div>
        </div>
        {inv.notes && <p className="mt-3 text-sm text-muted">Notes: {inv.notes}</p>}
      </Card>

      {/* Draft actions: add lines, issue, void */}
      {inv.status === "draft" && (
        <Card className="mb-4">
          <p className="mb-2 text-sm font-medium text-ink">Add a line</p>
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-6">
              <Input
                placeholder="Description"
                value={newLine.description}
                onChange={(e) => setNewLine({ ...newLine, description: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Input
                type="number"
                value={newLine.quantity}
                onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })}
              />
            </div>
            <div className="col-span-3">
              <Input
                type="number"
                value={newLine.unitPrice}
                onChange={(e) => setNewLine({ ...newLine, unitPrice: e.target.value })}
              />
            </div>
            <div className="col-span-1 flex items-center">
              <Button variant="secondary" onClick={addLine} disabled={busy || !newLine.description}>
                +
              </Button>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={issue} disabled={busy || inv.lines.length === 0}>
              Issue invoice
            </Button>
            <Button variant="danger" onClick={voidInvoice} disabled={busy}>
              Void
            </Button>
          </div>
        </Card>
      )}

      {/* Issued actions: mark paid, download PDF, void */}
      {inv.status === "issued" && (
        <Card className="mb-4">
          <p className="mb-2 text-sm font-medium text-ink">Record offline payment</p>
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-4">
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div className="col-span-6">
              <Input
                placeholder="Reference (optional)"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
              />
            </div>
            <div className="col-span-2">
              <Button onClick={markPaid} disabled={busy}>
                Mark paid
              </Button>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={downloadPdf}>
              Download PDF
            </Button>
            <Button variant="danger" onClick={voidInvoice} disabled={busy}>
              Void
            </Button>
          </div>
        </Card>
      )}

      {(inv.status === "paid" || inv.status === "void") && (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={downloadPdf}>
            Download PDF
          </Button>
        </div>
      )}
    </>
  );
}
