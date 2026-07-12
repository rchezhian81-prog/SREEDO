"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { Paginated } from "@/types";

const METHODS = ["cash", "card", "bank_transfer", "upi", "cheque", "online"] as const;

interface RefundablePayment {
  id: string;
  amount: string;
  method: string;
  paidAt: string;
  invoiceNo: string;
  studentName: string;
  refunded: string;
  refundable: string;
}

interface Refund {
  id: string;
  amount: string;
  reason: string | null;
  method: string;
  refundedAt: string;
  invoiceNo: string;
  studentName: string;
  paymentAmount: string;
}

const money = (v: string | number) => Number(v).toFixed(2);

export default function FeeRefundsPage() {
  const [payments, setPayments] = useState<RefundablePayment[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [paySearch, setPaySearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<RefundablePayment | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Refund | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRefunds = useCallback(async () => {
    const result = await api.get<Paginated<Refund>>("/fee-refunds?limit=50");
    setRefunds(result.data);
  }, []);

  const loadPayments = useCallback(async () => {
    const q = paySearch ? `?search=${encodeURIComponent(paySearch)}` : "";
    setPayments(await api.get<RefundablePayment[]>(`/fee-refunds/payments${q}`));
  }, [paySearch]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([loadPayments(), loadRefunds()])
      .catch(() => setError("Could not load refunds."))
      .finally(() => setLoading(false));
  }, [loadPayments, loadRefunds]);

  const openModal = (p: RefundablePayment) => {
    setTarget(p);
    setAmount(money(p.refundable));
    setReason("");
    setMethod("cash");
    setFormError(null);
  };

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.post("/fee-refunds", {
        paymentId: target.id,
        amount: Number(amount),
        reason: reason || undefined,
        method,
      });
      setTarget(null);
      await Promise.all([loadPayments(), loadRefunds()]);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to record refund");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemoveRefund = async () => {
    if (!pendingDelete) return;
    setError(null);
    setDeleting(true);
    try {
      await api.delete(`/fee-refunds/${pendingDelete.id}`);
      await Promise.all([loadPayments(), loadRefunds()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <>
      <div className="mb-2">
        <Link href="/fees" className="text-sm text-brand-600 hover:underline">
          ← Back to fees
        </Link>
      </div>
      <PageHeader title="Fee Refunds" subtitle="Record and track refunds against fee payments" />

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Record a refund
            </h2>
            <div className="mb-3 max-w-sm">
              <Input
                placeholder="Search invoice or student…"
                value={paySearch}
                onChange={(e) => setPaySearch(e.target.value)}
              />
            </div>
            {payments.length === 0 ? (
              <EmptyState message="No payments found" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Invoice</th>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Paid</th>
                      <th className="px-4 py-3">Refundable</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-surface-2">
                        <td className="px-4 py-3 text-ink">{p.invoiceNo}</td>
                        <td className="px-4 py-3 text-muted">{p.studentName}</td>
                        <td className="px-4 py-3 text-muted">{money(p.amount)}</td>
                        <td className="px-4 py-3 font-medium text-ink">{money(p.refundable)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            disabled={Number(p.refundable) <= 0}
                            onClick={() => openModal(p)}
                            className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-40"
                          >
                            Refund
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Refund history
            </h2>
            {refunds.length === 0 ? (
              <EmptyState message="No refunds recorded yet" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
                    <tr>
                      <th className="px-4 py-3">Invoice</th>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {refunds.map((r) => (
                      <tr key={r.id} className="hover:bg-surface-2">
                        <td className="px-4 py-3 text-ink">{r.invoiceNo}</td>
                        <td className="px-4 py-3 text-muted">{r.studentName}</td>
                        <td className="px-4 py-3 font-medium text-ink">{money(r.amount)}</td>
                        <td className="px-4 py-3 text-muted">{r.reason ?? "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setPendingDelete(r)}
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <Modal title="Record refund" open={target !== null} onClose={() => setTarget(null)}>
        {target ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {target.invoiceNo} · {target.studentName} · paid {money(target.amount)} · refundable{" "}
              <span className="font-medium text-ink">{money(target.refundable)}</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount">
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  max={target.refundable}
                />
              </Field>
              <Field label="Method">
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Reason">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <ErrorNote message={formError} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setTarget(null)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={saving || Number(amount) <= 0}>
                {saving ? "Saving…" : "Record refund"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete refund"
        message={
          pendingDelete
            ? `Delete this refund of ${money(pendingDelete.amount)}? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={confirmRemoveRefund}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
