"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorNote, Field, Input, Spinner, Textarea } from "@/components/ui";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import type { DrGuide } from "@/types";
import { formatDateTime } from "./taxonomy";

type SectionKey =
  | "policySummary"
  | "restoreProcess"
  | "approvalProcess"
  | "emergencyInstructions"
  | "preRestoreChecklist"
  | "postRestoreChecklist"
  | "rollbackGuide";

const SECTIONS: { key: SectionKey; label: string; hint?: string; rows: number }[] = [
  { key: "policySummary", label: "Policy summary", hint: "RPO/RTO, cadence, ownership.", rows: 3 },
  { key: "restoreProcess", label: "Restore process", rows: 5 },
  { key: "approvalProcess", label: "Approval process", rows: 4 },
  { key: "emergencyInstructions", label: "Emergency instructions", rows: 4 },
  { key: "preRestoreChecklist", label: "Pre-restore checklist", hint: "One item per line.", rows: 5 },
  { key: "postRestoreChecklist", label: "Post-restore checklist", hint: "One item per line.", rows: 5 },
  { key: "rollbackGuide", label: "Rollback guide", rows: 4 },
];

type FormState = Record<SectionKey, string> & {
  ownerName: string;
  ownerContact: string;
  sopLink: string;
};

function toForm(g: DrGuide): FormState {
  return {
    policySummary: g.policySummary ?? "",
    restoreProcess: g.restoreProcess ?? "",
    approvalProcess: g.approvalProcess ?? "",
    emergencyInstructions: g.emergencyInstructions ?? "",
    preRestoreChecklist: g.preRestoreChecklist ?? "",
    postRestoreChecklist: g.postRestoreChecklist ?? "",
    rollbackGuide: g.rollbackGuide ?? "",
    ownerName: g.ownerName ?? "",
    ownerContact: g.ownerContact ?? "",
    sopLink: g.sopLink ?? "",
  };
}

/** "" → null so the API stores an absent section rather than an empty string. */
function nullable(v: string): string | null {
  return v.trim() === "" ? null : v;
}

export function DrGuideTab({ reloadKey }: { reloadKey: number }) {
  const [guide, setGuide] = useState<DrGuide | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const g = await api.get<DrGuide>("/backups/dr-guide");
      setGuide(g);
      setForm(toForm(g));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load DR guide");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (loading) return <Spinner />;
  if (error && !guide) return <ErrorNote message={error} />;
  if (!guide || !form) return null;

  const patch = (p: Partial<FormState>) => setForm((prev) => (prev ? { ...prev, ...p } : prev));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<DrGuide>("/backups/dr-guide", {
        policySummary: nullable(form.policySummary),
        restoreProcess: nullable(form.restoreProcess),
        approvalProcess: nullable(form.approvalProcess),
        emergencyInstructions: nullable(form.emergencyInstructions),
        preRestoreChecklist: nullable(form.preRestoreChecklist),
        postRestoreChecklist: nullable(form.postRestoreChecklist),
        rollbackGuide: nullable(form.rollbackGuide),
        ownerName: nullable(form.ownerName),
        ownerContact: nullable(form.ownerContact),
        sopLink: nullable(form.sopLink),
      });
      setGuide(updated);
      setForm(toForm(updated));
      toast.success("DR guide saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save DR guide");
    } finally {
      setSaving(false);
    }
  };

  const markReviewed = async () => {
    setReviewing(true);
    setError(null);
    try {
      const updated = await api.patch<DrGuide>("/backups/dr-guide", { markReviewed: true });
      setGuide(updated);
      setForm(toForm(updated));
      toast.success("DR guide marked as reviewed.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to mark reviewed");
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Disaster-recovery runbook
          </h2>
          <p className="mt-1 text-xs text-faint">
            Last reviewed: {formatDateTime(guide.lastReviewedAt)} · Updated:{" "}
            {formatDateTime(guide.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={markReviewed} disabled={reviewing || saving}>
            <Icon name="check" className="h-4 w-4" />
            {reviewing ? "Marking…" : "Mark reviewed"}
          </Button>
          <Button onClick={save} disabled={saving || reviewing}>
            {saving ? "Saving…" : "Save guide"}
          </Button>
        </div>
      </div>

      <ErrorNote message={error} />

      <Card>
        <p className="mb-4 text-sm font-semibold text-ink">Ownership</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Owner name">
            <Input value={form.ownerName} onChange={(e) => patch({ ownerName: e.target.value })} placeholder="DR owner" />
          </Field>
          <Field label="Owner contact">
            <Input
              value={form.ownerContact}
              onChange={(e) => patch({ ownerContact: e.target.value })}
              placeholder="email / phone"
            />
          </Field>
          <Field label="SOP link">
            <Input
              value={form.sopLink}
              onChange={(e) => patch({ sopLink: e.target.value })}
              placeholder="https://runbook…"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <p className="mb-4 text-sm font-semibold text-ink">Runbook sections</p>
        <div className="space-y-4">
          {SECTIONS.map((s) => (
            <Field key={s.key} label={s.label} hint={s.hint}>
              <Textarea
                rows={s.rows}
                value={form[s.key]}
                onChange={(e) => patch({ [s.key]: e.target.value } as Partial<FormState>)}
                placeholder={`Document the ${s.label.toLowerCase()}…`}
              />
            </Field>
          ))}
        </div>
      </Card>
    </div>
  );
}
