"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
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
interface AuditEvent {
  action: string;
  actorEmail: string | null;
  actorRole: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}
interface LinkedInvoice {
  id: string;
  number: string | null;
  status: string;
  institutionName: string | null;
  institutionCode: string | null;
}
interface Note {
  id: string;
  invoiceId: string;
  institutionId: string;
  kind: "credit" | "debit";
  number: string | null;
  status: string;
  reason: string | null;
  currency: string;
  subtotal: string;
  taxPercent: string;
  taxAmount: string;
  total: string;
  sacCode: string | null;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  recipientState: string | null;
  recipientStateCode: string | null;
  notes: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  issuedAt: string | null;
  lines: Line[];
  invoice: LinkedInvoice | null;
}

type Tone = "slate" | "green" | "amber" | "red" | "blue";
const statusTone = (s: string): Tone =>
  s === "issued" ? "blue" : s === "void" ? "slate" : "amber";

type LineDraft = { id: string; description: string; quantity: string; unitPrice: string };

export default function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newLine, setNewLine] = useState({ description: "", quantity: "1", unitPrice: "0" });
  const [editingLine, setEditingLine] = useState<LineDraft | null>(null);

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  // Edit-draft header form (prefilled from the loaded note).
  const [edit, setEdit] = useState({
    currency: "",
    taxPercent: "0",
    reason: "",
    notes: "",
    sacCode: "",
    placeOfSupply: "",
    recipientState: "",
    recipientStateCode: "",
    reverseCharge: false,
  });

  const money = (v: string | number) => formatMoney(v, note?.currency ?? "INR");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, auditRows] = await Promise.all([
        api.get<Note>(`/platform/notes/${id}`),
        api.get<AuditEvent[]>(`/platform/notes/${id}/audit`).catch(() => []),
      ]);
      setNote(data);
      setAudit(auditRows);
      setEdit({
        currency: data.currency ?? "",
        taxPercent: String(Number(data.taxPercent) || 0),
        reason: data.reason ?? "",
        notes: data.notes ?? "",
        sacCode: data.sacCode ?? "",
        placeOfSupply: data.placeOfSupply ?? "",
        recipientState: data.recipientState ?? "",
        recipientStateCode: data.recipientStateCode ?? "",
        reverseCharge: data.reverseCharge ?? false,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load note");
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
      await api.post(`/platform/notes/${id}/lines`, {
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
      await api.patch(`/platform/notes/${id}/lines/${editingLine.id}`, {
        description: editingLine.description,
        quantity: Number(editingLine.quantity) || 0,
        unitPrice: Number(editingLine.unitPrice) || 0,
      });
      setEditingLine(null);
    });

  const saveEdit = () =>
    act(() =>
      api.patch(`/platform/notes/${id}`, {
        currency: edit.currency || undefined,
        taxPercent: Number(edit.taxPercent) || 0,
        reason: edit.reason || null,
        notes: edit.notes || null,
        sacCode: edit.sacCode || null,
        placeOfSupply: edit.placeOfSupply || null,
        recipientState: edit.recipientState || null,
        recipientStateCode: edit.recipientStateCode || null,
        reverseCharge: edit.reverseCharge,
      })
    );

  const issue = () => act(() => api.post(`/platform/notes/${id}/issue`));

  const doVoid = () =>
    act(async () => {
      await api.post(`/platform/notes/${id}/void`, { reason: voidReason.trim() });
      setVoidOpen(false);
      setVoidReason("");
    });

  const runRemove = async () => {
    if (!confirmRemove) return;
    setConfirmBusy(true);
    setError(null);
    try {
      await api.delete(`/platform/notes/${id}/lines/${confirmRemove}`);
      setConfirmRemove(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setConfirmBusy(false);
    }
  };

  const askDelete = () =>
    act(async () => {
      await api.delete(`/platform/notes/${id}`);
      router.push(note ? `/super-admin/invoices/${note.invoiceId}` : "/super-admin/invoices");
    });

  const downloadPdf = async () => {
    const token = useAuthStore.getState().accessToken;
    const res = await fetch(`${API_URL}/platform/notes/${id}/pdf`, {
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
  if (error && !note) return <ErrorNote message={error} />;
  if (!note) return <ErrorNote message="Note not found" />;

  const isDraft = note.status === "draft";
  const kindLabel = note.kind === "credit" ? "Credit note" : "Debit note";

  return (
    <>
      <PageHeader
        title={note.number ?? `Draft ${kindLabel.toLowerCase()}`}
        subtitle={kindLabel}
        action={
          <Button
            variant="secondary"
            onClick={() => router.push(`/super-admin/invoices/${note.invoiceId}`)}
          >
            ← Back to invoice
          </Button>
        }
      />

      {error && <ErrorNote message={error} />}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={downloadPdf}>
          Download PDF
        </Button>
        {isDraft && (
          <Button variant="danger" onClick={askDelete} disabled={busy}>
            Delete draft
          </Button>
        )}
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={note.kind === "credit" ? "green" : "amber"}>{note.kind}</Badge>
          <Badge tone={statusTone(note.status)}>{note.status}</Badge>
          <span className="text-xs text-muted">Currency {note.currency}</span>
          {note.issuedAt && (
            <span className="text-xs text-muted">Issued {formatDate(note.issuedAt)}</span>
          )}
          {note.sacCode && <span className="text-xs text-muted">SAC/HSN {note.sacCode}</span>}
          {note.placeOfSupply && (
            <span className="text-xs text-muted">Place of supply: {note.placeOfSupply}</span>
          )}
          {note.reverseCharge && <span className="text-xs text-muted">Reverse charge</span>}
        </div>
        {note.invoice && (
          <div className="mt-3 text-sm text-muted">
            Against invoice{" "}
            <Link
              href={`/super-admin/invoices/${note.invoice.id}`}
              className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
            >
              {note.invoice.number ?? "(draft)"}
            </Link>
            {note.invoice.institutionName ? ` · ${note.invoice.institutionName}` : ""}
            <span className="ml-2 inline-block align-middle">
              <Badge tone="slate">{note.invoice.status}</Badge>
            </span>
          </div>
        )}
        {note.reason && <p className="mt-2 text-sm text-muted">Reason: {note.reason}</p>}
        {note.status === "void" && note.voidReason && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-400">
            Void reason: {note.voidReason}
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
            {note.lines.map((l) => {
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
                          onClick={() => setConfirmRemove(l.id)}
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
            {note.lines.length === 0 && (
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
            <span>{money(note.subtotal)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Tax ({Number(note.taxPercent).toFixed(2)}%)</span>
            <span>{money(note.taxAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-1 font-semibold text-ink">
            <span>{note.kind === "credit" ? "Credit total" : "Debit total"}</span>
            <span>{money(note.total)}</span>
          </div>
        </div>
        {note.notes && <p className="mt-3 text-sm text-muted">Notes: {note.notes}</p>}
      </Card>

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
              <Field label="Reason">
                <Textarea
                  rows={2}
                  value={edit.reason}
                  onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
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
              <Button onClick={issue} disabled={busy || note.lines.length === 0}>
                Issue {kindLabel.toLowerCase()}
              </Button>
              <Button variant="danger" onClick={() => setVoidOpen(true)} disabled={busy}>
                Void
              </Button>
            </div>
          </Card>
        </>
      )}

      {note.status === "issued" && (
        <Card className="mb-4">
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => setVoidOpen(true)} disabled={busy}>
              Void
            </Button>
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
                  {a.action.replace(/^note\./, "").replace(/_/g, " ")}
                </span>
                <span className="text-faint">{formatDate(a.createdAt)}</span>
                {a.actorEmail && <span className="text-muted">· {a.actorEmail}</span>}
                {a.ip && <span className="text-faint">· {a.ip}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal title={`Void ${kindLabel.toLowerCase()}`} open={voidOpen} onClose={() => setVoidOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Voiding keeps the note in the records but marks it void. This can&apos;t be undone.
          </p>
          <Field label="Reason (required)">
            <Textarea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setVoidOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doVoid} disabled={busy || !voidReason.trim()}>
              {busy ? "Voiding…" : "Void note"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove line"
        message="Remove this line item from the draft?"
        confirmLabel="Remove"
        busy={confirmBusy}
        onConfirm={runRemove}
        onClose={() => setConfirmRemove(null)}
      />
    </>
  );
}
