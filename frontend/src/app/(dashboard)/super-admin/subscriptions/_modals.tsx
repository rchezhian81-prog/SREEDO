"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { BILLING_CYCLES, NOTE_TYPES, type PackageBrief } from "./_subs";

export type SubAction =
  | "extend"
  | "renew"
  | "change-package"
  | "cancel"
  | "suspend"
  | "reactivate"
  | "mark-expired"
  | "note";

const TITLES: Record<SubAction, string> = {
  extend: "Extend subscription",
  renew: "Renew subscription",
  "change-package": "Change package",
  cancel: "Cancel subscription",
  suspend: "Suspend subscription",
  reactivate: "Reactivate subscription",
  "mark-expired": "Mark expired",
  note: "Add note",
};

// Actions whose backend schema requires a reason of at least 5 characters.
const REASON_REQUIRED: SubAction[] = [
  "change-package",
  "cancel",
  "suspend",
  "mark-expired",
];

interface FormState {
  reason: string;
  endsAt: string;
  effectiveDate: string;
  periods: string;
  billingCycle: string;
  packageId: string;
  createInvoice: boolean;
  suspendTenant: boolean;
  reactivateTenant: boolean;
  noteType: string;
  body: string;
  followUpDate: string;
  owner: string;
}

const EMPTY: FormState = {
  reason: "",
  endsAt: "",
  effectiveDate: "",
  periods: "1",
  billingCycle: "",
  packageId: "",
  createInvoice: false,
  suspendTenant: false,
  reactivateTenant: false,
  noteType: "general",
  body: "",
  followUpDate: "",
  owner: "",
};

/**
 * Shared reason/impact-aware modal driving every manual subscription action.
 * Used identically by the list and detail pages: on success it toasts and calls
 * `onSuccess()` so the caller can refresh. All mutations return the updated
 * detail (or notes array); a 400 ApiError message (e.g. "reason required") is
 * surfaced inline.
 */
export function SubscriptionActionModal({
  action,
  subId,
  packages,
  currentPackageId,
  onClose,
  onSuccess,
}: {
  action: SubAction | null;
  subId: string | null;
  packages: PackageBrief[];
  currentPackageId?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [f, setF] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time a new action is opened.
  useEffect(() => {
    if (action) {
      setF({ ...EMPTY });
      setError(null);
      setSaving(false);
    }
  }, [action, subId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((s) => ({ ...s, [k]: v }));

  const reasonNeeded = action ? REASON_REQUIRED.includes(action) : false;

  const canSubmit = useMemo(() => {
    if (!action) return false;
    if (reasonNeeded && f.reason.trim().length < 5) return false;
    if (action === "extend" && !f.endsAt) return false;
    if (action === "change-package" && !f.packageId) return false;
    if (action === "note" && f.body.trim().length === 0) return false;
    if (action === "renew" && (Number(f.periods) || 0) < 1) return false;
    return true;
  }, [action, reasonNeeded, f]);

  if (!action || !subId) return null;

  const opt = (v: string) => (v.trim() === "" ? undefined : v.trim());

  const submit = async () => {
    setSaving(true);
    setError(null);
    const base = `/platform/subscriptions/${subId}`;
    try {
      switch (action) {
        case "extend":
          await api.post(`${base}/extend`, {
            endsAt: f.endsAt,
            reason: opt(f.reason),
          });
          break;
        case "renew":
          await api.post(`${base}/renew`, {
            periods: Number(f.periods) || 1,
            billingCycle: opt(f.billingCycle),
            packageId: opt(f.packageId),
            createInvoice: f.createInvoice,
            reason: opt(f.reason),
          });
          break;
        case "change-package":
          await api.post(`${base}/change-package`, {
            packageId: f.packageId,
            effectiveDate: opt(f.effectiveDate),
            reason: f.reason.trim(),
          });
          break;
        case "cancel":
          await api.post(`${base}/cancel`, {
            reason: f.reason.trim(),
            effectiveDate: opt(f.effectiveDate),
          });
          break;
        case "suspend":
          await api.post(`${base}/suspend`, {
            reason: f.reason.trim(),
            suspendTenant: f.suspendTenant,
          });
          break;
        case "reactivate":
          await api.post(`${base}/reactivate`, {
            reason: opt(f.reason),
            endsAt: opt(f.endsAt),
            reactivateTenant: f.reactivateTenant,
          });
          break;
        case "mark-expired":
          await api.post(`${base}/mark-expired`, { reason: f.reason.trim() });
          break;
        case "note":
          await api.post(`${base}/notes`, {
            noteType: f.noteType,
            body: f.body.trim(),
            followUpDate: opt(f.followUpDate),
            owner: opt(f.owner),
          });
          break;
      }
      toast.success(`${TITLES[action]} — done`);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setSaving(false);
    }
  };

  const danger = action === "cancel" || action === "suspend" || action === "mark-expired";

  return (
    <Modal title={TITLES[action]} open onClose={onClose}>
      <div className="space-y-4">
        {action === "change-package" && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Changing the package updates this tenant&apos;s plan, limits and
            pricing immediately. Existing invoices are not modified. This change
            is audited.
          </div>
        )}
        {action === "cancel" && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            Cancelling stops the subscription. History is preserved — the tenant
            is not deleted. You can reactivate later.
          </div>
        )}
        {action === "mark-expired" && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Marks the subscription expired now, bypassing the automatic
            lifecycle sweep. This is audited.
          </div>
        )}

        {action === "extend" && (
          <Field label="New end date">
            <Input
              type="date"
              value={f.endsAt}
              onChange={(e) => set("endsAt", e.target.value)}
            />
          </Field>
        )}

        {action === "renew" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Periods">
                <Input
                  type="number"
                  min={1}
                  value={f.periods}
                  onChange={(e) => set("periods", e.target.value)}
                />
              </Field>
              <Field label="Billing cycle (optional)">
                <Select
                  value={f.billingCycle}
                  onChange={(e) => set("billingCycle", e.target.value)}
                >
                  <option value="">Derive from package</option>
                  {BILLING_CYCLES.map((c) => (
                    <option key={c} value={c}>
                      {c.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Package (optional)">
              <Select
                value={f.packageId}
                onChange={(e) => set("packageId", e.target.value)}
              >
                <option value="">Keep current package</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.billingCycle})
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line"
                checked={f.createInvoice}
                onChange={(e) => set("createInvoice", e.target.checked)}
              />
              Create a draft renewal invoice
            </label>
          </>
        )}

        {action === "change-package" && (
          <>
            <Field label="New package">
              <Select
                value={f.packageId}
                onChange={(e) => set("packageId", e.target.value)}
              >
                <option value="">Choose a package…</option>
                {packages
                  .filter((p) => p.id !== currentPackageId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.billingCycle})
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Effective date (optional)">
              <Input
                type="date"
                value={f.effectiveDate}
                onChange={(e) => set("effectiveDate", e.target.value)}
              />
            </Field>
          </>
        )}

        {action === "cancel" && (
          <Field label="Effective date (optional)">
            <Input
              type="date"
              value={f.effectiveDate}
              onChange={(e) => set("effectiveDate", e.target.value)}
            />
          </Field>
        )}

        {action === "suspend" && (
          <label className="flex items-start gap-2 text-sm text-muted">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-line"
              checked={f.suspendTenant}
              onChange={(e) => set("suspendTenant", e.target.checked)}
            />
            <span>
              Also lock the tenant — deactivates the institution so all its users
              lose access.
            </span>
          </label>
        )}

        {action === "reactivate" && (
          <>
            <Field label="New end date (optional)">
              <Input
                type="date"
                value={f.endsAt}
                onChange={(e) => set("endsAt", e.target.value)}
              />
            </Field>
            <label className="flex items-start gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-line"
                checked={f.reactivateTenant}
                onChange={(e) => set("reactivateTenant", e.target.checked)}
              />
              <span>Also re-enable the tenant (reactivates the institution).</span>
            </label>
          </>
        )}

        {action === "note" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select
                  value={f.noteType}
                  onChange={(e) => set("noteType", e.target.value)}
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
                  value={f.followUpDate}
                  onChange={(e) => set("followUpDate", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Note">
              <Textarea
                rows={4}
                value={f.body}
                onChange={(e) => set("body", e.target.value)}
              />
            </Field>
            <Field label="Owner (optional)">
              <Input
                value={f.owner}
                onChange={(e) => set("owner", e.target.value)}
                placeholder="Who owns this follow-up?"
              />
            </Field>
          </>
        )}

        {action !== "note" && (
          <Field
            label={
              reasonNeeded
                ? "Reason (required — audited)"
                : "Reason (optional — audited)"
            }
          >
            <Textarea
              rows={3}
              value={f.reason}
              onChange={(e) => set("reason", e.target.value)}
              placeholder={
                reasonNeeded ? "At least 5 characters" : "Optional context"
              }
            />
          </Field>
        )}

        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={submit}
            disabled={saving || !canSubmit}
          >
            {saving ? "Working…" : TITLES[action]}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The action items shown in row menus / detail toolbars. */
export const SUB_ACTIONS: { action: SubAction; label: string }[] = [
  { action: "extend", label: "Extend" },
  { action: "renew", label: "Renew" },
  { action: "change-package", label: "Change package" },
  { action: "suspend", label: "Suspend" },
  { action: "cancel", label: "Cancel" },
  { action: "reactivate", label: "Reactivate" },
  { action: "mark-expired", label: "Mark expired" },
  { action: "note", label: "Add note" },
];
