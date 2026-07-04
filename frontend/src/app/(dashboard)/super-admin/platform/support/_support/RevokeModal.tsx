"use client";

import { useEffect, useState } from "react";
import { Button, ErrorNote, Field, Modal, Textarea } from "@/components/ui";

const MIN_REASON = 5;

/**
 * Reason-required confirmation for revoking support access. Shared by the Active
 * list (single + bulk "by operator" / "by tenant") and the session drawer. The
 * caller owns the async `onConfirm(reason)`; this component only validates the
 * reason (min 5 chars, mirroring the backend) and manages busy/error state.
 */
export function RevokeModal({
  open,
  title,
  description,
  confirmLabel = "Revoke access",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the field each time the modal is opened.
  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const valid = reason.trim().length >= MIN_REASON;

  const submit = async () => {
    if (!valid) {
      setError(`Enter a reason of at least ${MIN_REASON} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} open={open} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-muted">{description}</div>
        <Field label="Reason (required)" error={error ?? undefined}>
          <Textarea
            rows={3}
            placeholder="e.g. Session running longer than the approved window (ticket #123)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <ErrorNote message={!valid && reason.length > 0 ? `Please enter at least ${MIN_REASON} characters.` : null} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} disabled={busy || !valid}>
            {busy ? "Revoking…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
