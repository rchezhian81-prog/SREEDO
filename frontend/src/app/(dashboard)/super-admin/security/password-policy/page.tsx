"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Spinner,
  Textarea,
} from "@/components/ui";
import { toast } from "@/components/toast";
import { usePermissions } from "@/lib/use-permissions";
import { usePlatformGuard } from "../../platform/_guard";
import type { PasswordPolicy } from "../_security";

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs font-medium text-faint">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

export default function PasswordPolicyPage() {
  const { ready, gate } = usePlatformGuard(
    "Password policy",
    "Password rules & the enforced auth baseline"
  );
  const { can } = usePermissions();
  const canManage = can("platform:security_manage");

  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [minLength, setMinLength] = useState("8");
  const [requireComplexity, setRequireComplexity] = useState(false);
  const [expiryDays, setExpiryDays] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const applyPolicy = (p: PasswordPolicy) => {
    setPolicy(p);
    setMinLength(String(p.minLength));
    setRequireComplexity(p.requireComplexity);
    setExpiryDays(p.expiryDays == null ? "" : String(p.expiryDays));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      applyPolicy(await api.get<PasswordPolicy>("/platform/security/password-policy"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : "Failed to load policy");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const minLenNum = Number(minLength);
  const minLenValid = Number.isInteger(minLenNum) && minLenNum >= 8 && minLenNum <= 128;
  const expiryNum = expiryDays.trim() ? Number(expiryDays) : null;
  const expiryValid =
    expiryNum === null || (Number.isInteger(expiryNum) && expiryNum >= 0 && expiryNum <= 3650);
  const canSubmit = minLenValid && expiryValid;

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const updated = await api.put<PasswordPolicy>(
        "/platform/security/password-policy",
        {
          minLength: minLenNum,
          requireComplexity,
          expiryDays: expiryNum,
          reason: reason.trim().length >= 5 ? reason.trim() : undefined,
        }
      );
      applyPolicy(updated);
      setReason("");
      toast.success("Password policy updated");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to update policy");
    } finally {
      setSaving(false);
    }
  };

  if (!ready) return gate;

  if (forbidden) {
    return (
      <>
        <PageHeader title="Password policy" subtitle="Password rules & the enforced auth baseline" />
        <EmptyState message="You don't have permission to view this." />
      </>
    );
  }

  return (
    <>
      <nav className="mb-2 text-xs text-faint">
        <Link href="/super-admin/security" className="hover:text-muted">
          Security Center
        </Link>{" "}
        / <span className="text-muted">Password policy</span>
      </nav>
      <PageHeader
        title="Password policy"
        subtitle="Password rules & the enforced auth baseline"
      />

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : !policy ? null : (
        <div className="space-y-6">
          {/* Enforced baseline (read-only facts) */}
          <div>
            <h2 className="mb-3 text-lg font-bold text-ink">Enforced baseline</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Minimum length" value={policy.enforced.minLength} />
              <Fact
                label="Password reset link TTL"
                value={`${policy.enforced.passwordResetTtlMinutes} min`}
              />
              <Fact label="Access token TTL" value={policy.enforced.accessTokenTtl} />
              <Fact
                label="Refresh token TTL"
                value={`${policy.enforced.refreshTokenTtlDays} days`}
              />
              <Fact
                label="Lockout after"
                value={`${policy.enforced.lockout.maxFailedAttempts} attempts`}
              />
              <Fact
                label="Lockout duration"
                value={`${policy.enforced.lockout.lockoutMinutes} min`}
              />
            </div>
            <div className="mt-3 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-600 dark:text-brand-300">
              Enforcement note: the auth engine enforces the baseline shown above;
              this policy summary is audited and surfaced to operators.
            </div>
          </div>

          {/* Editable policy summary */}
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-ink">Policy summary</h2>
                <p className="text-xs text-muted">
                  An audited, operator-facing summary of the intended password rules.
                </p>
              </div>
              {!canManage && <Badge tone="slate">Read-only</Badge>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Minimum length"
                error={minLenValid ? undefined : "Must be 8–128"}
                hint="Characters required in a password."
              >
                <Input
                  type="number"
                  min={8}
                  max={128}
                  value={minLength}
                  disabled={!canManage}
                  onChange={(e) => setMinLength(e.target.value)}
                />
              </Field>
              <Field
                label="Expiry (days)"
                error={expiryValid ? undefined : "0–3650, or blank"}
                hint="0 or blank means passwords never expire."
              >
                <Input
                  type="number"
                  min={0}
                  max={3650}
                  value={expiryDays}
                  disabled={!canManage}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  placeholder="Never"
                />
              </Field>
            </div>

            <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">Require complexity</p>
                <p className="text-xs text-muted">
                  Mix of upper/lower case, digits and symbols.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={requireComplexity}
                disabled={!canManage}
                onClick={() => setRequireComplexity((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  requireComplexity ? "bg-brand-600" : "bg-hover"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    requireComplexity ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {canManage && (
              <>
                <div className="mt-4">
                  <Field label="Reason (optional — audited)">
                    <Textarea
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why is the policy changing?"
                    />
                  </Field>
                </div>
                <ErrorNote message={formError} />
                <div className="mt-4 flex justify-end">
                  <Button onClick={save} disabled={saving || !canSubmit}>
                    {saving ? "Saving…" : "Save policy"}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
