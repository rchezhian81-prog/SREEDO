"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { formatDate, formatMoney } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
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

interface Line {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  sacCode: string | null;
  amount: string;
}
interface EmailLog {
  id: string;
  recipient: string;
  template: string;
  status: string;
  error: string | null;
  createdAt: string;
}
interface AuditEvent {
  action: string;
  actorEmail: string | null;
  actorRole: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}
interface Invoice {
  id: string;
  institutionId: string;
  number: string | null;
  status: string;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  paymentTermsDays: number | null;
  dueDate: string | null;
  isOverdue: boolean;
  subtotal: string;
  taxPercent: string;
  taxAmount: string;
  total: string;
  gstin: string | null;
  billingName: string | null;
  billingAddress: string | null;
  taxNotes: string | null;
  notes: string | null;
  sacCode: string | null;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  recipientState: string | null;
  recipientStateCode: string | null;
  roundOff: string;
  voidReason: string | null;
  voidedAt: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  lines: Line[];
  emails: EmailLog[];
}

type Tone = "slate" | "green" | "amber" | "red" | "blue";
const statusTone = (s: string): Tone =>
  s === "paid" ? "green" : s === "issued" ? "blue" : s === "void" ? "slate" : "amber";

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  run: () => Promise<unknown>;
  reloadAfter?: boolean;
};

type LineDraft = { id: string; description: string; quantity: string; unitPrice: string };

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newLine, setNewLine] = useState({ description: "", quantity: "1", unitPrice: "0" });
  const [editingLine, setEditingLine] = useState<LineDraft | null>(null);
  const [payMethod, setPayMethod] = useState("bank_transfer");
  const [payRef, setPayRef] = useState("");

  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  // Edit-draft header form (prefilled from the loaded invoice).
  const [edit, setEdit] = useState({
    currency: "",
    taxPercent: "0",
    paymentTermsDays: "",
    dueDate: "",
    billingName: "",
    gstin: "",
    billingAddress: "",
    periodStart: "",
    periodEnd: "",
    taxNotes: "",
    notes: "",
    sacCode: "",
    placeOfSupply: "",
    recipientState: "",
    recipientStateCode: "",
    reverseCharge: false,
  });

  const money = (v: string | number) => formatMoney(v, inv?.currency ?? "INR");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, auditRows] = await Promise.all([
        api.get<Invoice>(`/platform/invoices/${id}`),
        api.get<AuditEvent[]>(`/platform/invoices/${id}/audit`).catch(() => []),
      ]);
      setInv(data);
      setAudit(auditRows);
      setEdit({
        currency: data.currency ?? "",
        taxPercent: String(Number(data.taxPercent) || 0),
        paymentTermsDays:
          data.paymentTermsDays != null ? String(data.paymentTermsDays) : "",
        dueDate: data.dueDate ?? "",
        billingName: data.billingName ?? "",
        gstin: data.gstin ?? "",
        billingAddress: data.billingAddress ?? "",
        periodStart: data.periodStart ?? "",
        periodEnd: data.periodEnd ?? "",
        taxNotes: data.taxNotes ?? "",
        notes: data.notes ?? "",
        sacCode: data.sacCode ?? "",
        placeOfSupply: data.placeOfSupply ?? "",
        recipientState: data.recipientState ?? "",
        recipientStateCode: data.recipientStateCode ?? "",
        reverseCharge: data.reverseCharge ?? false,
      });
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
    setNotice(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    setError(null);
    setNotice(null);
    try {
      await confirm.run();
      const reload = confirm.reloadAfter !== false;
      setConfirm(null);
      if (reload) await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setConfirmBusy(false);
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

  const startEditLine = (l: Line) =>
    setEditingLine({
      id: l.id,
      description: l.description,
      quantity: String(Number(l.quantity)),
      unitPrice: String(Number(l.unitPrice)),
    });

  const saveLine = () =>
    act(async () => {
      if (!editingLine) return;
      await api.patch(`/platform/invoices/${id}/lines/${editingLine.id}`, {
        description: editingLine.description,
        quantity: Number(editingLine.quantity) || 0,
        unitPrice: Number(editingLine.unitPrice) || 0,
      });
      setEditingLine(null);
    });

  const saveEdit = () =>
    act(() =>
      api.patch(`/platform/invoices/${id}`, {
        currency: edit.currency || undefined,
        taxPercent: Number(edit.taxPercent) || 0,
        paymentTermsDays: edit.paymentTermsDays ? Number(edit.paymentTermsDays) : null,
        dueDate: edit.dueDate || null,
        billingName: edit.billingName || null,
        gstin: edit.gstin || null,
        billingAddress: edit.billingAddress || null,
        periodStart: edit.periodStart || null,
        periodEnd: edit.periodEnd || null,
        taxNotes: edit.taxNotes || null,
        notes: edit.notes || null,
        sacCode: edit.sacCode || null,
        placeOfSupply: edit.placeOfSupply || null,
        recipientState: edit.recipientState || null,
        recipientStateCode: edit.recipientStateCode || null,
        reverseCharge: edit.reverseCharge,
      })
    );

  const issue = () => act(() => api.post(`/platform/invoices/${id}/issue`));

  const markPaid = () =>
    act(() =>
      api.post(`/platform/invoices/${id}/mark-paid`, {
        paymentMethod: payMethod,
        reference: payRef || undefined,
      })
    );

  const resend = () =>
    act(async () => {
      const r = await api.post<{ recipients: number }>(
        `/platform/invoices/${id}/resend`
      );
      setNotice(
        r.recipients > 0
          ? `Invoice email sent to ${r.recipients} admin recipient(s).`
          : "No active admin emails found (or email is not configured)."
      );
    });

  const duplicate = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.post<{ id: string }>(
        `/platform/invoices/${id}/duplicate`
      );
      router.push(`/super-admin/invoices/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to duplicate invoice");
      setBusy(false);
    }
  };

  const doVoid = () =>
    act(async () => {
      await api.post(`/platform/invoices/${id}/void`, { reason: voidReason.trim() });
      setVoidOpen(false);
      setVoidReason("");
    });

  const askRemoveLine = (lineId: string) =>
    setConfirm({
      title: "Remove line",
      message: "Remove this line item from the draft?",
      confirmLabel: "Remove",
      run: () => api.delete(`/platform/invoices/${id}/lines/${lineId}`),
    });

  const askDelete = () =>
    setConfirm({
      title: "Delete draft",
      message:
        "Permanently delete this draft invoice and its line items? This can't be undone.",
      confirmLabel: "Delete",
      reloadAfter: false,
      run: async () => {
        await api.delete(`/platform/invoices/${id}`);
        router.push("/super-admin/invoices");
      },
    });

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

  const isDraft = inv.status === "draft";

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
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {/* Toolbar: actions available regardless of edit state */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={downloadPdf}>
          Download PDF
        </Button>
        <Button variant="secondary" onClick={duplicate} disabled={busy}>
          Duplicate
        </Button>
        {(inv.status === "issued" || inv.status === "paid") && (
          <Button variant="secondary" onClick={resend} disabled={busy}>
            Resend email
          </Button>
        )}
        {isDraft && (
          <Button variant="danger" onClick={askDelete} disabled={busy}>
            Delete draft
          </Button>
        )}
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
          {inv.isOverdue && <Badge tone="red">overdue</Badge>}
          <span className="text-xs text-muted">Currency {inv.currency}</span>
          {(inv.periodStart || inv.periodEnd) && (
            <span className="text-xs text-muted">
              Period {inv.periodStart ?? "?"} → {inv.periodEnd ?? "?"}
            </span>
          )}
          {inv.issuedAt && (
            <span className="text-xs text-muted">Issued {formatDate(inv.issuedAt)}</span>
          )}
          {inv.dueDate && (
            <span
              className={`text-xs ${
                inv.isOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted"
              }`}
            >
              Due {formatDate(inv.dueDate)}
            </span>
          )}
          {inv.status === "paid" && inv.paidAt && (
            <span className="text-xs text-muted">
              Paid {formatDate(inv.paidAt)}
              {inv.paymentMethod ? ` · ${inv.paymentMethod}` : ""}
              {inv.paymentReference ? ` · ${inv.paymentReference}` : ""}
            </span>
          )}
          {inv.sacCode && <span className="text-xs text-muted">SAC/HSN {inv.sacCode}</span>}
          {inv.placeOfSupply && (
            <span className="text-xs text-muted">Place of supply: {inv.placeOfSupply}</span>
          )}
          {inv.reverseCharge && <span className="text-xs text-muted">Reverse charge</span>}
        </div>
        {inv.status === "void" && inv.voidReason && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400">
            Void reason: {inv.voidReason}
          </div>
        )}
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
              {isDraft && <th className="py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {inv.lines.map((l) => {
              const editing = editingLine?.id === l.id;
              if (editing && editingLine) {
                return (
                  <tr key={l.id}>
                    <td className="py-2 pr-2">
                      <Input
                        value={editingLine.description}
                        onChange={(e) =>
                          setEditingLine({ ...editingLine, description: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        value={editingLine.quantity}
                        onChange={(e) =>
                          setEditingLine({ ...editingLine, quantity: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        value={editingLine.unitPrice}
                        onChange={(e) =>
                          setEditingLine({ ...editingLine, unitPrice: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-2 text-right text-faint">—</td>
                    <td className="py-2">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={saveLine}
                          disabled={busy || !editingLine.description.trim()}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50 dark:text-brand-300"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingLine(null)}
                          disabled={busy}
                          className="text-xs text-muted hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={l.id}>
                  <td className="py-2 text-ink">{l.description}</td>
                  <td className="py-2 text-muted">{Number(l.quantity)}</td>
                  <td className="py-2 text-muted">{money(l.unitPrice)}</td>
                  <td className="py-2 text-right text-ink">{money(l.amount)}</td>
                  {isDraft && (
                    <td className="py-2">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => startEditLine(l)}
                          disabled={busy}
                          className="text-xs text-brand-600 hover:text-brand-700 dark:text-brand-300"
                          aria-label="Edit line"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => askRemoveLine(l.id)}
                          disabled={busy}
                          className="text-xs text-red-600 hover:text-red-700"
                          aria-label="Remove line"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {inv.lines.length === 0 && (
              <tr>
                <td colSpan={isDraft ? 5 : 4} className="py-3 text-faint">
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

      {/* Draft: edit header, add/edit/remove lines, issue, void */}
      {isDraft && (
        <>
          <Card className="mb-4">
            <p className="mb-3 text-sm font-medium text-ink">Edit draft details</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency">
                <Input
                  value={edit.currency}
                  onChange={(e) => setEdit({ ...edit, currency: e.target.value })}
                />
              </Field>
              <Field label="Tax %">
                <Input
                  type="number"
                  value={edit.taxPercent}
                  onChange={(e) => setEdit({ ...edit, taxPercent: e.target.value })}
                />
              </Field>
              <Field label="Payment terms (days)">
                <Input
                  type="number"
                  placeholder="e.g. 15"
                  value={edit.paymentTermsDays}
                  onChange={(e) => setEdit({ ...edit, paymentTermsDays: e.target.value })}
                />
              </Field>
              <Field label="Due date">
                <Input
                  type="date"
                  value={edit.dueDate}
                  onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })}
                />
              </Field>
              <Field label="Period start">
                <Input
                  type="date"
                  value={edit.periodStart}
                  onChange={(e) => setEdit({ ...edit, periodStart: e.target.value })}
                />
              </Field>
              <Field label="Period end">
                <Input
                  type="date"
                  value={edit.periodEnd}
                  onChange={(e) => setEdit({ ...edit, periodEnd: e.target.value })}
                />
              </Field>
              <Field label="Billing name">
                <Input
                  value={edit.billingName}
                  onChange={(e) => setEdit({ ...edit, billingName: e.target.value })}
                />
              </Field>
              <Field label="GSTIN">
                <Input
                  value={edit.gstin}
                  onChange={(e) => setEdit({ ...edit, gstin: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Billing address">
                <Textarea
                  rows={2}
                  value={edit.billingAddress}
                  onChange={(e) => setEdit({ ...edit, billingAddress: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="SAC/HSN">
                <Input
                  value={edit.sacCode}
                  onChange={(e) => setEdit({ ...edit, sacCode: e.target.value })}
                />
              </Field>
              <Field label="Place of supply">
                <Input
                  value={edit.placeOfSupply}
                  onChange={(e) => setEdit({ ...edit, placeOfSupply: e.target.value })}
                />
              </Field>
              <Field label="Recipient state">
                <Input
                  value={edit.recipientState}
                  onChange={(e) => setEdit({ ...edit, recipientState: e.target.value })}
                />
              </Field>
              <Field label="Recipient state code">
                <Input
                  value={edit.recipientStateCode}
                  onChange={(e) => setEdit({ ...edit, recipientStateCode: e.target.value })}
                />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={edit.reverseCharge}
                onChange={(e) => setEdit({ ...edit, reverseCharge: e.target.checked })}
                className="h-4 w-4 rounded border-line"
              />
              Reverse charge applicable
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Tax notes">
                <Textarea
                  rows={2}
                  value={edit.taxNotes}
                  onChange={(e) => setEdit({ ...edit, taxNotes: e.target.value })}
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  rows={2}
                  value={edit.notes}
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-3">
              <Button variant="secondary" onClick={saveEdit} disabled={busy}>
                Save details
              </Button>
            </div>
          </Card>

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
                <Button
                  variant="secondary"
                  onClick={addLine}
                  disabled={busy || !newLine.description}
                >
                  +
                </Button>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={issue} disabled={busy || inv.lines.length === 0}>
                Issue invoice
              </Button>
              <Button variant="danger" onClick={() => setVoidOpen(true)} disabled={busy}>
                Void
              </Button>
            </div>
          </Card>
        </>
      )}

      {/* Issued: mark paid, void */}
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
            <Button variant="danger" onClick={() => setVoidOpen(true)} disabled={busy}>
              Void
            </Button>
          </div>
        </Card>
      )}

      {inv.emails.length > 0 && (
        <Card className="mb-4">
          <p className="mb-2 text-sm font-medium text-ink">Email delivery log</p>
          <div className="space-y-1.5 text-sm">
            {inv.emails.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={e.status === "sent" ? "green" : e.status === "failed" ? "red" : "slate"}>
                  {e.status}
                </Badge>
                <span className="text-ink">{e.recipient}</span>
                <span className="text-faint">{formatDate(e.createdAt)}</span>
                {e.error && <span className="text-xs text-red-600">{e.error}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {audit.length > 0 && (
        <Card className="mb-4">
          <p className="mb-2 text-sm font-medium text-ink">Audit timeline</p>
          <div className="text-sm">
            {audit.map((a, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 last:border-0"
              >
                <span className="font-medium capitalize text-ink">
                  {a.action.replace(/^invoice\./, "").replace(/_/g, " ")}
                </span>
                <span className="text-faint">{formatDate(a.createdAt)}</span>
                {a.actorEmail && <span className="text-muted">· {a.actorEmail}</span>}
                {a.ip && <span className="text-faint">· {a.ip}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal title="Void invoice" open={voidOpen} onClose={() => setVoidOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Voiding keeps the invoice in the records but marks it void. A paid invoice
            can&apos;t be voided. This can&apos;t be undone.
          </p>
          <Field label="Reason (required)">
            <Textarea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setVoidOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doVoid} disabled={busy || !voidReason.trim()}>
              {busy ? "Voiding…" : "Void invoice"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
