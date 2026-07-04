"use client";

import { useEffect, useState } from "react";
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
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import {
  API_TOKEN_SCOPES,
  roleLabel,
  todayISO,
  type IpAllowlistState,
  type TokenReveal,
  type TwoFaPolicy,
  type TwoFaPolicyRole,
} from "./_security";

type WarnTone = "amber" | "red";

function Callout({ tone, children }: { tone: WarnTone; children: React.ReactNode }) {
  return (
    <div
      className={
        tone === "red"
          ? "rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
          : "rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
      }
    >
      {children}
    </div>
  );
}

/**
 * Generic reason-required modal (reason ≥ 5 chars) for sensitive actions —
 * session revoke, revoke-all, lock/unlock. Mirrors `admins/_modals`
 * AdminActionModal and `rbac/_modals` ArchiveRoleModal: the parent supplies an
 * `onSubmit(reason)` that performs the API call + toast; a thrown ApiError is
 * surfaced inline so backend guards (last-owner / self / not-found) stay visible.
 */
export function ReasonModal({
  open,
  title,
  cta,
  danger,
  warning,
  description,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  cta: string;
  danger?: boolean;
  warning?: { tone: WarnTone; text: string } | null;
  description?: React.ReactNode;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit = reason.trim().length >= 5;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={title} open onClose={onClose}>
      <div className="space-y-4">
        {description && <div className="text-sm text-muted">{description}</div>}
        {warning && <Callout tone={warning.tone}>{warning.text}</Callout>}
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
            {saving ? "Working…" : cta}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Edit a role's 2FA requirement (toggle + optional grace date). Reason optional
 * (audited). On success hands the refreshed policy back to the parent.
 */
export function TwoFaPolicyModal({
  role,
  onClose,
  onSaved,
}: {
  role: TwoFaPolicyRole | null;
  onClose: () => void;
  onSaved: (policy: TwoFaPolicy) => void;
}) {
  const [require2fa, setRequire2fa] = useState(false);
  const [graceUntil, setGraceUntil] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role) {
      setRequire2fa(role.require2fa);
      setGraceUntil(role.graceUntil ? role.graceUntil.slice(0, 10) : "");
      setReason("");
      setError(null);
      setSaving(false);
    }
  }, [role]);

  if (!role) return null;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const policy = await api.put<TwoFaPolicy>("/platform/security/2fa/policy", {
        roleKey: role.roleKey,
        require2fa,
        graceUntil: require2fa && graceUntil ? graceUntil : null,
        reason: reason.trim().length >= 5 ? reason.trim() : undefined,
      });
      toast.success(`2FA policy updated for ${role.name}`);
      onSaved(policy);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update policy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`2FA policy · ${role.name}`} open onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {role.usersInRole} user{role.usersInRole === 1 ? "" : "s"} in this role
          {role.usersWithout2fa > 0 && (
            <>
              {" "}
              ·{" "}
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {role.usersWithout2fa} without 2FA
              </span>
            </>
          )}
          .
        </p>
        <Field
          label="Require two-factor"
          hint="When required, users in this role must enable 2FA (after any grace period)."
        >
          <Select
            value={require2fa ? "yes" : "no"}
            onChange={(e) => setRequire2fa(e.target.value === "yes")}
          >
            <option value="no">Not required</option>
            <option value="yes">Required</option>
          </Select>
        </Field>
        {require2fa && (
          <Field
            label="Grace period until (optional)"
            hint="Users have until this date to enable 2FA before they are non-compliant."
          >
            <Input
              type="date"
              min={todayISO()}
              value={graceUntil}
              onChange={(e) => setGraceUntil(e.target.value)}
            />
          </Field>
        )}
        <Field label="Reason (optional — audited)">
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this policy changing?"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save policy"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface PickableAdmin {
  id: string;
  fullName: string;
  email: string;
  platformRole: string | null;
  locked: boolean;
}

/**
 * Lock a chosen platform account (reason ≥ 5 chars). Owner/self are protected by
 * the backend — the 400 is surfaced inline. Only unlocked admins are listed.
 */
export function LockAccountModal({
  open,
  onClose,
  onLocked,
}: {
  open: boolean;
  onClose: () => void;
  onLocked: () => void;
}) {
  const [admins, setAdmins] = useState<PickableAdmin[]>([]);
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUserId("");
    setReason("");
    setError(null);
    setSaving(false);
    api
      .get<{ rows: PickableAdmin[] }>("/platform/admins?pageSize=100&status=active")
      .then((d) => setAdmins(d.rows.filter((a) => !a.locked)))
      .catch(() => setAdmins([]));
  }, [open]);

  if (!open) return null;

  const canSubmit = !!userId && reason.trim().length >= 5;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post(`/platform/security/users/${userId}/lock`, {
        reason: reason.trim(),
      });
      toast.success("Account locked");
      onLocked();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to lock account");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Lock an account" open onClose={onClose}>
      <div className="space-y-4">
        <Callout tone="red">
          Locking immediately revokes the account&apos;s sessions and blocks
          sign-in until unlocked. Owner and your own account are protected.
        </Callout>
        <Field label="Account">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="" disabled>
              Select an admin…
            </option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fullName} · {a.email} ({roleLabel(a.platformRole)})
              </option>
            ))}
          </Select>
        </Field>
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
          <Button variant="danger" onClick={submit} disabled={saving || !canSubmit}>
            {saving ? "Locking…" : "Lock account"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Create an API token. Scopes are entered as a comma/space separated list. On
 * success the parent receives the ONE-TIME reveal to show in TokenRevealModal.
 */
export function CreateApiTokenModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (reveal: TokenReveal) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setScopes([]);
      setExpiresInDays("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const toggleScope = (value: string) =>
    setScopes((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    );

  const days = expiresInDays.trim() ? Number(expiresInDays) : null;
  const daysValid =
    days === null || (Number.isInteger(days) && days >= 1 && days <= 3650);
  const canSubmit = name.trim().length >= 2 && daysValid;

  if (!open) return null;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const reveal = await api.post<TokenReveal>("/platform/security/api-tokens", {
        name: name.trim(),
        description: description.trim() || undefined,
        scopes,
        expiresInDays: days,
      });
      toast.success(`Token "${name.trim()}" created`);
      onCreated(reveal);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create token");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create API token" open onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-600 dark:text-brand-300">
          The full token value is shown <span className="font-semibold">once</span>{" "}
          after creation and never again. Store it somewhere safe.
        </div>
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CI pipeline"
          />
        </Field>
        <Field label="Description (optional)">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this token used for?"
          />
        </Field>
        <fieldset className="block">
          <legend className="mb-1.5 block text-sm font-medium text-ink">Scopes</legend>
          <p className="mb-2 text-xs text-faint">
            What this token may read from the external API. Grant the minimum
            needed.
          </p>
          <div className="space-y-2">
            {API_TOKEN_SCOPES.map((s) => (
              <label
                key={s.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 transition hover:bg-hover"
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(s.value)}
                  onChange={() => toggleScope(s.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="block font-mono text-xs text-ink">{s.value}</span>
                  <span className="block text-xs text-muted">{s.label}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label="Expires in (days, optional)"
          error={daysValid ? undefined : "1–3650 days"}
        >
          <Input
            type="number"
            min={1}
            max={3650}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            placeholder="Never expires if blank"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !canSubmit}>
            {saving ? "Creating…" : "Create token"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * One-time token reveal. This is the ONLY place a full token value appears —
 * copy-to-clipboard with a permanent "you won't see this again" warning.
 */
export function TokenRevealModal({
  reveal,
  onClose,
}: {
  reveal: TokenReveal | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (reveal) setCopied(false);
  }, [reveal]);

  if (!reveal) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal.token);
      setCopied(true);
      toast.success("Token copied to clipboard");
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  return (
    <Modal title="Copy your API token" open onClose={onClose}>
      <div className="space-y-4">
        <Callout tone="red">
          This is the only time you&apos;ll see this token. Copy it now and store
          it securely — it cannot be retrieved again.
        </Callout>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Token</p>
          <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-sm text-ink">
              {reveal.token}
            </code>
            <Button variant="secondary" onClick={copy}>
              <Icon name={copied ? "check" : "clipboard"} className="h-4 w-4" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-1 text-xs text-faint">
            Prefix{" "}
            <span className="font-mono text-muted">{reveal.tokenPrefix}</span> is
            all that is stored and shown in the list.
          </p>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>I&apos;ve saved it</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Enable/disable IP-allowlist enforcement. High-risk: enabling can lock everyone
 * out, so the backend refuses to enable a rule that would exclude the caller —
 * that 400 is surfaced inline. Reason optional (audited).
 */
export function IpAllowlistToggleModal({
  open,
  enabling,
  currentIp,
  currentAllowed,
  onClose,
  onSaved,
}: {
  open: boolean;
  enabling: boolean;
  currentIp: string | null;
  currentAllowed: boolean;
  onClose: () => void;
  onSaved: (state: IpAllowlistState) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const state = await api.put<IpAllowlistState>(
        "/platform/security/ip-allowlist/enabled",
        {
          enabled: enabling,
          reason: reason.trim().length >= 5 ? reason.trim() : undefined,
        }
      );
      toast.success(
        enabling ? "IP allowlist enforcement enabled" : "IP allowlist disabled"
      );
      onSaved(state);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update allowlist";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={enabling ? "Enable IP allowlist" : "Disable IP allowlist"}
      open
      onClose={onClose}
    >
      <div className="space-y-4">
        {enabling ? (
          <Callout tone="amber">
            While enabled, every sensitive platform action is blocked from IPs not
            on the allowlist. Your current IP{" "}
            <span className="font-mono">{currentIp ?? "unknown"}</span>{" "}
            {currentAllowed ? (
              <span className="font-semibold">is on the allowlist.</span>
            ) : (
              <span className="font-semibold">
                is NOT on the allowlist — add it first or you will be locked out.
              </span>
            )}
          </Callout>
        ) : (
          <Callout tone="amber">
            Disabling turns off IP restrictions — sensitive actions will be
            permitted from any IP again.
          </Callout>
        )}
        <Field label="Reason (optional — audited)">
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is enforcement changing?"
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={enabling ? "primary" : "danger"}
            onClick={submit}
            disabled={saving}
          >
            {saving ? "Saving…" : enabling ? "Enable allowlist" : "Disable allowlist"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
