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
import { toast } from "@/components/toast";
import type { Role, RoleDetail, RoleStatus } from "./_rbac";

const KEY_RE = /^[a-z][a-z0-9_]{2,48}$/;

/**
 * Create a custom role. The key is immutable once created and validated against
 * the same pattern the backend enforces; permissions can optionally be seeded
 * from an existing role/template ("copy from").
 */
export function CreateRoleModal({
  open,
  templates,
  onClose,
  onCreated,
}: {
  open: boolean;
  templates: Role[];
  onClose: () => void;
  onCreated: (role: RoleDetail) => void;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKey("");
      setName("");
      setDescription("");
      setCopyFrom("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const keyValid = KEY_RE.test(key);
  const canSubmit = keyValid && name.trim().length > 0;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const role = await api.post<RoleDetail>("/platform/rbac/roles", {
        key: key.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        copyFrom: copyFrom || undefined,
      });
      toast.success(`Role "${role.name}" created`);
      onCreated(role);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create role");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal title="Create role" open onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-600 dark:text-brand-300">
          Custom roles let you grant a platform admin a limited slice of access.
          Set permissions after creating, or copy them from an existing role.
        </div>
        <Field
          label="Key"
          hint="Immutable. 3–49 chars: lowercase letters, digits, underscores; must start with a letter."
          error={
            key.length > 0 && !keyValid ? "Invalid key format" : undefined
          }
        >
          <Input
            value={key}
            onChange={(e) =>
              setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
            }
            placeholder="e.g. billing_readonly"
          />
        </Field>
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Billing (read-only)"
          />
        </Field>
        <Field label="Description (optional)">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this role for?"
          />
        </Field>
        <Field
          label="Copy permissions from (optional)"
          hint="Seed this role's permissions from an existing role, then fine-tune."
        >
          <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">Start with no permissions</option>
            {templates.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name} ({r.key})
              </option>
            ))}
          </Select>
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !canSubmit}>
            {saving ? "Creating…" : "Create role"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Edit a role's name/description/status. Owner cannot be disabled. */
export function EditRoleModal({
  role,
  onClose,
  onSaved,
}: {
  role: Role | null;
  onClose: () => void;
  onSaved: (role: RoleDetail) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<RoleStatus>("active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role) {
      setName(role.name);
      setDescription(role.description ?? "");
      setStatus(role.status === "archived" ? "active" : role.status);
      setError(null);
      setSaving(false);
    }
  }, [role]);

  const canSubmit = name.trim().length > 0;

  if (!role) return null;

  const isArchived = role.status === "archived";

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
      };
      // Status is only editable for active/disabled roles (archive is separate).
      if (!isArchived) body.status = status;
      const updated = await api.patch<RoleDetail>(
        `/platform/rbac/roles/${role.key}`,
        body
      );
      toast.success("Role updated");
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update role");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit role" open onClose={onClose}>
      <div className="space-y-4">
        <Field label="Key" hint="Keys are immutable and cannot be changed.">
          <Input value={role.key} disabled />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {!isArchived && (
          <Field
            label="Status"
            hint={
              role.isOwner
                ? "The owner role cannot be disabled."
                : "Disabled roles cannot be assigned to admins."
            }
          >
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as RoleStatus)}
              disabled={role.isOwner}
            >
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </Select>
          </Field>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !canSubmit}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Archive a custom role (reason required, ≥5 chars). The backend blocks
 * archiving built-in/owner roles or roles that still have users assigned; those
 * failures surface inline.
 */
export function ArchiveRoleModal({
  role,
  onClose,
  onArchived,
}: {
  role: Role | null;
  onClose: () => void;
  onArchived: (role: RoleDetail) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role) {
      setReason("");
      setError(null);
      setSaving(false);
    }
  }, [role]);

  if (!role) return null;

  const canSubmit = reason.trim().length >= 5;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.post<RoleDetail>(
        `/platform/rbac/roles/${role.key}/archive`,
        { reason: reason.trim() }
      );
      toast.success(`Role "${role.name}" archived`);
      onArchived(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to archive role");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Archive role" open onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          Archiving hides <span className="font-semibold">{role.name}</span> from
          assignment. It cannot be archived while any admin still holds it, or if
          it is a built-in / owner role.
        </div>
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
            {saving ? "Archiving…" : "Archive role"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
