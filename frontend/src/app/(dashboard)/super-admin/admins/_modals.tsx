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
import {
  PLATFORM_ROLES,
  roleLabel,
  type Admin,
} from "./_admins";

// The high-risk, reason-required actions that flow through the shared modal.
export type AdminAction =
  | "enable"
  | "disable"
  | "lock"
  | "unlock"
  | "reset-2fa"
  | "change-role";

const TITLES: Record<AdminAction, string> = {
  enable: "Enable admin",
  disable: "Disable admin",
  lock: "Lock account",
  unlock: "Unlock account",
  "reset-2fa": "Reset two-factor",
  "change-role": "Change platform role",
};

const CTA: Record<AdminAction, string> = {
  enable: "Enable",
  disable: "Disable",
  lock: "Lock",
  unlock: "Unlock",
  "reset-2fa": "Reset 2FA",
  "change-role": "Change role",
};

// Actions whose confirm button reads as destructive.
const DANGER: AdminAction[] = ["disable", "lock", "reset-2fa"];

function warning(action: AdminAction): { tone: "amber" | "red"; text: string } | null {
  switch (action) {
    case "disable":
      return {
        tone: "red",
        text: "Disabling signs the admin out of every session and blocks sign-in. History is preserved — the account is not deleted and can be re-enabled.",
      };
    case "lock":
      return {
        tone: "red",
        text: "Locking immediately revokes all sessions and blocks sign-in until an admin unlocks the account.",
      };
    case "reset-2fa":
      return {
        tone: "amber",
        text: "This clears the admin's two-factor secret. They will be prompted to enrol a new authenticator on next sign-in.",
      };
    case "change-role":
      return {
        tone: "amber",
        text: "Changing the platform role changes what this admin can do across the console. This change is audited.",
      };
    default:
      return null;
  }
}

/**
 * Shared reason-aware modal driving every high-risk platform-admin action
 * (enable/disable, lock/unlock, reset-2FA and change-role). Used identically by
 * the list and detail pages: every action requires an audited reason of at least
 * 5 characters (mirrors the zod schema); change-role additionally takes a role.
 * On success it toasts, hands the updated admin back to `onSuccess`, and closes.
 * A 400 ApiError (e.g. "Cannot disable the last active owner") is surfaced
 * inline so last-owner / self-action guards are always visible.
 */
export function AdminActionModal({
  action,
  admin,
  onClose,
  onSuccess,
}: {
  action: AdminAction | null;
  admin: Admin | null;
  onClose: () => void;
  onSuccess: (updated: Admin) => void;
}) {
  const [reason, setReason] = useState("");
  const [role, setRole] = useState<string>("platform_admin");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time a new action opens.
  useEffect(() => {
    if (action && admin) {
      setReason("");
      setRole(admin.platformRole ?? "platform_admin");
      setError(null);
      setSaving(false);
    }
  }, [action, admin]);

  const canSubmit = useMemo(() => {
    if (!action) return false;
    if (reason.trim().length < 5) return false;
    if (action === "change-role" && !role) return false;
    return true;
  }, [action, reason, role]);

  if (!action || !admin) return null;

  const submit = async () => {
    setSaving(true);
    setError(null);
    const base = `/platform/admins/${admin.id}`;
    const r = reason.trim();
    try {
      let updated: Admin;
      switch (action) {
        case "enable":
          updated = await api.patch<Admin>(`${base}/active`, {
            isActive: true,
            reason: r,
          });
          break;
        case "disable":
          updated = await api.patch<Admin>(`${base}/active`, {
            isActive: false,
            reason: r,
          });
          break;
        case "lock":
          updated = await api.post<Admin>(`${base}/lock`, { reason: r });
          break;
        case "unlock":
          updated = await api.post<Admin>(`${base}/unlock`, { reason: r });
          break;
        case "reset-2fa":
          updated = await api.post<Admin>(`${base}/reset-2fa`, { reason: r });
          break;
        case "change-role":
          updated = await api.post<Admin>(`${base}/role`, {
            platformRole: role,
            reason: r,
          });
          break;
      }
      toast.success(`${TITLES[action]} — done`);
      onSuccess(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setSaving(false);
    }
  };

  const warn = warning(action);
  const danger = DANGER.includes(action);

  return (
    <Modal title={TITLES[action]} open onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">{admin.fullName}</span>{" "}
          <span className="text-faint">· {admin.email}</span>
        </p>

        {warn && (
          <div
            className={
              warn.tone === "red"
                ? "rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
                : "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
            }
          >
            {warn.text}
          </div>
        )}

        {action === "change-role" && (
          <Field label="New platform role" hint={`Currently ${roleLabel(admin.platformRole)}`}>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {PLATFORM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Reason (required — audited)">
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="At least 5 characters"
          />
        </Field>

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
            {saving ? "Working…" : CTA[action]}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Invite a new internal platform admin. On success the server reports whether the
 * invite email was actually delivered (`emailSent`) — when SMTP is unconfigured
 * we tell the operator to share the link manually rather than silently succeed.
 */
export function InviteAdminModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [platformRole, setPlatformRole] = useState<string>("platform_admin");
  const [fullName, setFullName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail("");
      setPlatformRole("platform_admin");
      setFullName("");
      setExpiresInDays("7");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const days = Number(expiresInDays);
  const daysValid = Number.isInteger(days) && days >= 1 && days <= 30;
  const canSubmit = emailValid && !!platformRole && daysValid;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await api.post<{ id: string; emailSent: boolean }>(
        "/platform/admins/invites",
        {
          email: email.trim(),
          platformRole,
          fullName: fullName.trim() || undefined,
          expiresInDays: days,
        }
      );
      if (r.emailSent) {
        toast.success(`Invite sent to ${email.trim()}`);
      } else {
        toast.info("SMTP not configured — share the invite link manually");
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send invite");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal title="Invite platform admin" open onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-600 dark:text-brand-300">
          The invitee receives a secure link to set their own password. No
          password is ever created or shared here.
        </div>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform role">
            <Select
              value={platformRole}
              onChange={(e) => setPlatformRole(e.target.value)}
            >
              {PLATFORM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invite valid for (days)">
            <Input
              type="number"
              min={1}
              max={30}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Full name (optional)">
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Shown on the invite; they can change it"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !canSubmit}>
            {saving ? "Sending…" : "Send invite"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
