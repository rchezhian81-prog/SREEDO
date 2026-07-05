"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { PlatformExport } from "@/types";
import { scopeLabel } from "./taxonomy";
import { useInstitutions } from "./useInstitutions";

const MIN_REASON = 8;

const INCLUDED = [
  "Institution profile",
  "Users (masked — no password hashes)",
  "Subscription",
  "Invoices",
  "Payments",
  "Subscription packages",
  "Document metadata",
  "README + manifest.json + per-file checksums",
];

const EXCLUDED = [
  "Password / credential hashes",
  "API & gateway keys",
  "Auth / refresh tokens",
  "2FA / TOTP seeds",
  "Session & webhook signing keys",
  "Internal storage paths",
];

/**
 * Request a full tenant data-portability pack: a masked ZIP of the tenant's
 * profile, users, billing and document metadata plus a README, manifest and
 * per-file checksums. As the highest-risk export it is ALWAYS approval-gated —
 * it is created pending and only built after a different super-admin approves it
 * (from the Exports tab), then downloadable there (reason required). No secrets
 * are ever included.
 */
export function PortabilityTab({
  reloadKey,
  onChanged,
  onJumpToExports,
}: {
  reloadKey: number;
  onChanged: () => void;
  onJumpToExports: () => void;
}) {
  const institutions = useInstitutions(true);

  const [institutionId, setInstitutionId] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PlatformExport | null>(null);

  // Clear the last-result panel when the console-wide Refresh is hit.
  useEffect(() => {
    setCreated(null);
    setError(null);
  }, [reloadKey]);

  const reasonValid = reason.trim().length >= MIN_REASON;
  const canSubmit = Boolean(institutionId) && reasonValid && !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const pack = await api.post<PlatformExport>("/exports/portability", {
        institutionId,
        ...(name.trim() ? { name: name.trim() } : {}),
        reason: reason.trim(),
      });
      setCreated(pack);
      toast.success("Portability pack requested — it needs a different super-admin's approval before it is built.");
      setName("");
      setReason("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate portability pack");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <p className="mb-1 text-sm font-semibold text-ink">Generate a data-portability pack</p>
        <p className="mb-4 text-xs text-muted">
          A masked ZIP export of a single tenant&apos;s data — useful for offboarding, GDPR/DPDP
          data-subject requests or migration. It is sensitive and fully audited.
        </p>
        <div className="space-y-4">
          <Field label="Tenant">
            <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
              <option value="">Select an institution…</option>
              {institutions.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name} ({inst.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pack name (optional)" hint="Defaults to “Portability pack — <tenant>”.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Offboarding pack — Springfield High"
            />
          </Field>
          <Field
            label="Reason (required — min 8 characters)"
            hint="Recorded in the platform audit log."
            error={reason.length > 0 && !reasonValid ? "At least 8 characters required." : undefined}
          >
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. DPDP data-subject request #1423 — tenant offboarding"
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end">
            <Button variant="danger" onClick={submit} disabled={!canSubmit}>
              <Icon name="packageOpen" className="h-4 w-4" />
              {busy ? "Generating…" : "Generate portability pack"}
            </Button>
          </div>

          {created && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone="amber">Pending approval</Badge>
                <Badge tone="slate">{scopeLabel(created.scope)}</Badge>
                <span className="font-medium text-ink">{created.name}</span>
              </div>
              <p className="text-xs text-muted">
                The pack has been requested and is awaiting a different super-admin&apos;s approval.
                Once approved it is built and becomes downloadable (reason required) from the Exports tab.
              </p>
              <div className="mt-3">
                <Button variant="secondary" onClick={onJumpToExports}>
                  <Icon name="fileDown" className="h-4 w-4" />
                  View in Exports history
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <p className="mb-3 text-sm font-semibold text-ink">What&apos;s in the pack</p>
        <div className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600">Included</p>
          <ul className="space-y-1.5 text-sm text-muted">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
            <Icon name="shieldAlert" className="h-4 w-4" />
            Never included
          </p>
          <ul className="space-y-1 text-sm text-red-600/90 dark:text-red-400/90">
            {EXCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Icon name="x" className="mt-0.5 h-4 w-4 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-xs text-faint">
          Every row is scrubbed through the platform redaction filter before it is written. The pack
          appears in the Exports history, where it can be downloaded (reason required) or archived.
        </p>
      </Card>
    </div>
  );
}
