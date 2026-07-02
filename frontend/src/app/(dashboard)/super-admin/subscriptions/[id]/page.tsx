"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
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
import { toast } from "@/components/toast";
import { formatDate, formatMoney } from "@/lib/format";
import { usePlatformGuard } from "../../platform/_guard";
import {
  SubscriptionActionModal,
  SUB_ACTIONS,
  type SubAction,
} from "../_modals";
import {
  cellText,
  inGrace,
  NOTE_TYPES,
  statusLabel,
  statusTone,
  type PackageBrief,
  type Reminder,
  type SendReminderResult,
  type SubDetail,
  type SubNote,
} from "../_subs";

const TABS = [
  "Overview",
  "Billing",
  "Package",
  "Timeline",
  "Notes",
  "Reminders",
] as const;
type Tab = (typeof TABS)[number];
const tabSlug = (name: string) => name.toLowerCase();

export default function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, gate } = usePlatformGuard(
    "Subscription",
    "Subscription detail"
  );

  const [d, setD] = useState<SubDetail | null>(null);
  const [packages, setPackages] = useState<PackageBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [action, setAction] = useState<SubAction | null>(null);

  // Deep-link ?tab= (client-only, avoids the useSearchParams Suspense need).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (!raw) return;
    const match = TABS.find((t) => tabSlug(t) === raw.toLowerCase());
    if (match) setTab(match);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setD(await api.get<SubDetail>(`/platform/subscriptions/${id}`));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load subscription"
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

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

  if (!ready) return gate;
  if (loading) return <Spinner />;
  if (error && !d) return <ErrorNote message={error} />;
  if (!d) return <ErrorNote message="Subscription not found" />;

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/subscriptions" className="hover:text-muted">
          Subscriptions
        </Link>{" "}
        / <span className="text-muted">{d.institutionCode}</span>
      </nav>
      <PageHeader
        title={d.institutionName}
        subtitle={`${d.packageName} · ${d.billingCycle} · ${d.institutionType}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(d.status)}>{statusLabel(d.status)}</Badge>
            {inGrace(d) && <Badge tone="amber">grace</Badge>}
            <Badge tone={d.isActiveNow ? "green" : "slate"}>
              {d.isActiveNow ? "active now" : "inactive"}
            </Badge>
          </div>
        }
      />

      {error && <ErrorNote message={error} />}

      {/* Action toolbar */}
      <div className="mb-4 flex flex-wrap gap-2">
        {SUB_ACTIONS.map((x) => (
          <Button
            key={x.action}
            variant={
              x.action === "cancel" ||
              x.action === "suspend" ||
              x.action === "mark-expired"
                ? "danger"
                : "secondary"
            }
            onClick={() => setAction(x.action)}
          >
            {x.label}
          </Button>
        ))}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={
              tab === x
                ? "border-b-2 border-brand-600 px-3 py-2 text-sm font-semibold text-brand-700 dark:text-brand-300"
                : "px-3 py-2 text-sm font-medium text-muted hover:text-ink"
            }
          >
            {x}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab d={d} />}
      {tab === "Billing" && <BillingTab d={d} />}
      {tab === "Package" && <PackageTab d={d} />}
      {tab === "Timeline" && <TimelineTab d={d} />}
      {tab === "Notes" && <NotesTab d={d} onChanged={load} onAdd={() => setAction("note")} />}
      {tab === "Reminders" && <RemindersTab id={id} />}

      <SubscriptionActionModal
        action={action}
        subId={id}
        packages={packages}
        currentPackageId={d.packageId}
        onClose={() => setAction(null)}
        onSuccess={load}
      />
    </>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs font-medium text-faint">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
    </div>
  );
}

function OverviewTab({ d }: { d: SubDetail }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Status" value={statusLabel(d.status)} />
        <Tile label="Billing cycle" value={d.billingCycle} />
        <Tile label="Auto-renew" value={d.autoRenew ? "on" : "off"} />
        <Tile
          label="Active now"
          value={d.isActiveNow ? "yes" : "no"}
          hint={d.institutionActive ? "tenant enabled" : "tenant locked"}
        />
        <Tile label="Start" value={d.startsAt ?? "—"} />
        <Tile label="Expiry" value={d.endsAt ?? "—"} />
        <Tile label="Renewal" value={d.renewsAt ?? "—"} />
        <Tile label="Trial ends" value={d.trialEndsAt ?? "—"} />
        <Tile label="Grace until" value={d.graceUntil ?? "—"} />
        <Tile label="Price" value={formatMoney(d.price, d.currency)} />
        <Tile label="Outstanding" value={formatMoney(d.outstanding, d.currency)} />
        <Tile label="Overdue" value={formatMoney(d.overdue, d.currency)} />
      </div>
      <Card>
        <p className="mb-2 text-sm font-medium text-ink">Institution</p>
        <div className="grid grid-cols-2 gap-2 text-sm text-muted">
          <div>Name: {d.institutionName}</div>
          <div>Code: {d.institutionCode}</div>
          <div>Type: {d.institutionType}</div>
          <div>
            Tenant:{" "}
            {d.institutionActive ? (
              <Badge tone="green">enabled</Badge>
            ) : (
              <Badge tone="red">locked</Badge>
            )}
          </div>
          <div>Package: {d.packageName}</div>
          <div>Invoices: {d.invoiceCount}</div>
        </div>
        <div className="mt-3">
          <Link
            href={`/super-admin/platform/tenants/${d.institutionId}?tab=subscription-billing`}
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Open tenant →
          </Link>
        </div>
      </Card>
    </div>
  );
}

function BillingTab({ d }: { d: SubDetail }) {
  const inv = d.billing.latestInvoice;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Tile
          label="Outstanding"
          value={formatMoney(d.billing.outstanding, d.currency)}
        />
        <Tile
          label="Overdue"
          value={formatMoney(d.billing.overdue, d.currency)}
        />
      </div>
      <Card>
        <p className="mb-2 text-sm font-medium text-ink">Latest invoice</p>
        {inv ? (
          <div className="space-y-1 text-sm text-muted">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">
                {inv.number ?? "draft"}
              </span>
              <Badge tone={statusTone(inv.status === "paid" ? "active" : inv.status === "issued" ? "trialing" : "expired")}>
                {inv.status}
              </Badge>
              {inv.isOverdue && <Badge tone="red">overdue</Badge>}
            </div>
            <div>Total: {formatMoney(inv.total, d.currency)}</div>
            <div>Issued: {inv.issuedAt ? formatDate(inv.issuedAt) : "—"}</div>
            <div>Due: {inv.dueDate ? formatDate(inv.dueDate) : "—"}</div>
          </div>
        ) : (
          <p className="text-sm text-faint">No invoices yet.</p>
        )}
        <div className="mt-3">
          <Link
            href={`/super-admin/invoices?institutionId=${d.institutionId}`}
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Open this tenant&apos;s invoices →
          </Link>
        </div>
      </Card>
    </div>
  );
}

function PackageTab({ d }: { d: SubDetail }) {
  const limits = d.packageLimits ?? {};
  const limitKeys = Object.keys(limits);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Package" value={d.packageName} />
        <Tile label="Price" value={formatMoney(d.price, d.currency)} />
        <Tile label="Billing cycle" value={d.billingCycle} />
        <Tile
          label="Tax %"
          value={d.taxPercent != null ? String(d.taxPercent) : "—"}
        />
        <Tile
          label="Max students"
          value={d.maxStudents != null ? d.maxStudents : "∞"}
        />
        <Tile
          label="Max staff"
          value={d.maxStaff != null ? d.maxStaff : "∞"}
        />
      </div>
      <Card>
        <p className="mb-2 text-sm font-medium text-ink">Applicable types</p>
        {d.applicableTypes && d.applicableTypes.length ? (
          <div className="flex flex-wrap gap-1">
            {d.applicableTypes.map((t) => (
              <Badge key={t} tone="blue">
                {t}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-faint">All institution types</p>
        )}
      </Card>
      <Card>
        <p className="mb-2 text-sm font-medium text-ink">Package limits</p>
        {limitKeys.length ? (
          <div className="grid grid-cols-2 gap-2 text-sm text-muted sm:grid-cols-3">
            {limitKeys.map((k) => (
              <div
                key={k}
                className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5"
              >
                <span className="capitalize">{k}</span>
                <span className="font-medium text-ink">
                  {cellText((limits as Record<string, unknown>)[k])}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-faint">No extra limits configured.</p>
        )}
      </Card>
    </div>
  );
}

function TimelineTab({ d }: { d: SubDetail }) {
  if (!d.events.length)
    return <EmptyState message="No lifecycle events recorded yet" />;
  return (
    <Card>
      <ul className="divide-y divide-line text-sm">
        {d.events.map((ev) => (
          <li key={ev.id} className="py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone="slate">{ev.event}</Badge>
                {ev.fromStatus && ev.toStatus && (
                  <span className="text-muted">
                    {ev.fromStatus} → {ev.toStatus}
                  </span>
                )}
              </span>
              <span className="text-xs text-faint">
                {new Date(ev.createdAt).toLocaleString()}
              </span>
            </div>
            {ev.reason && (
              <p className="mt-1 text-xs text-muted">Reason: {ev.reason}</p>
            )}
            <p className="mt-0.5 text-xs text-faint">
              {ev.actorEmail ? `by ${ev.actorEmail}` : "system"}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NotesTab({
  d,
  onChanged,
  onAdd,
}: {
  d: SubDetail;
  onChanged: () => void;
  onAdd: () => void;
}) {
  const [editing, setEditing] = useState<SubNote | null>(null);
  const [deleting, setDeleting] = useState<SubNote | null>(null);
  const [busy, setBusy] = useState(false);

  const del = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/platform/subscriptions/notes/${deleting.id}`);
      toast.success("Note deleted");
      setDeleting(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={onAdd}>+ Add note</Button>
      </div>
      {d.notes.length === 0 ? (
        <EmptyState message="No notes yet" />
      ) : (
        <div className="space-y-3">
          {d.notes.map((n) => (
            <Card key={n.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="blue">{n.noteType}</Badge>
                  {n.followUpDate && (
                    <Badge tone="amber">follow-up {n.followUpDate}</Badge>
                  )}
                  {n.owner && (
                    <span className="text-xs text-faint">owner: {n.owner}</span>
                  )}
                </div>
                <div className="flex gap-3 text-xs">
                  <button
                    onClick={() => setEditing(n)}
                    className="font-medium text-brand-600 hover:text-brand-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleting(n)}
                    className="font-medium text-red-600 hover:text-red-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
                {n.body}
              </p>
              <p className="mt-2 text-xs text-faint">
                {n.createdByEmail ?? "—"} ·{" "}
                {new Date(n.createdAt).toLocaleString()}
              </p>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <NoteEditModal
          note={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete note"
        message="This soft-deletes the note (history is kept). Continue?"
        confirmLabel="Delete"
        busy={busy}
        onConfirm={del}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function NoteEditModal({
  note,
  onClose,
  onSaved,
}: {
  note: SubNote;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [noteType, setNoteType] = useState(note.noteType);
  const [body, setBody] = useState(note.body);
  const [followUpDate, setFollowUpDate] = useState(note.followUpDate ?? "");
  const [owner, setOwner] = useState(note.owner ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/platform/subscriptions/notes/${note.id}`, {
        noteType,
        body: body.trim(),
        followUpDate: followUpDate || null,
        owner: owner.trim() || null,
      });
      toast.success("Note updated");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit note" open onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select
              value={noteType}
              onChange={(e) => setNoteType(e.target.value)}
            >
              {NOTE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Follow-up date (optional)">
            <Input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Note">
          <Textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <Field label="Owner (optional)">
          <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || body.trim().length === 0}
          >
            {saving ? "Saving…" : "Save note"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RemindersTab({ id }: { id: string }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReminders(
        await api.get<Reminder[]>(`/platform/subscriptions/${id}/reminders`)
      );
    } catch {
      setReminders([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    setSending(true);
    try {
      const r = await api.post<SendReminderResult>(
        `/platform/subscriptions/${id}/reminder`
      );
      if (!r.configured) {
        toast.info("SMTP not configured — reminder logged but not delivered");
      } else {
        toast.success(`Reminder queued for ${r.recipients.length} recipient(s)`);
      }
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={send} disabled={sending}>
          {sending ? "Sending…" : "Send reminder now"}
        </Button>
      </div>
      {loading ? (
        <Spinner />
      ) : reminders.length === 0 ? (
        <EmptyState message="No reminders sent yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">By</th>
                <th className="px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reminders.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 text-ink">{r.toEmail}</td>
                  <td className="px-4 py-3 text-muted">{r.kind}</td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        r.status === "sent"
                          ? "green"
                          : r.status === "failed"
                            ? "red"
                            : "slate"
                      }
                    >
                      {r.status}
                    </Badge>
                    {r.error && (
                      <span className="ml-1 text-xs text-red-500">
                        {r.error}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-faint">{r.actorEmail ?? "—"}</td>
                  <td className="px-4 py-3 text-faint">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
