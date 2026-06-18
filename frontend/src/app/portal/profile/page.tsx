"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Badge,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type { StudentSummary } from "@/types";

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900">
        {value && value.trim() ? value : "—"}
      </span>
    </div>
  );
}

const STATUS_TONES: Record<
  string,
  "green" | "amber" | "red" | "slate" | "blue"
> = {
  active: "green",
  inactive: "slate",
  graduated: "blue",
  suspended: "amber",
};

export default function PortalProfilePage() {
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const [summary, setSummary] = useState<StudentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) {
      setSummary(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    portalApi
      .get<StudentSummary>(`/portal/students/${studentId}/summary`)
      .then(setSummary)
      .catch(() => setError("Could not load the profile."))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (!studentId) {
    return (
      <>
        <PageHeader title="Profile" />
        <EmptyState message="No student linked to your account yet." />
      </>
    );
  }

  if (loading) return <Spinner />;

  const p = summary?.profile;

  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="Student details on record"
        action={
          p ? (
            <Badge tone={STATUS_TONES[p.status] ?? "slate"}>{p.status}</Badge>
          ) : undefined
        }
      />
      <ErrorNote message={error} />
      {p && (
        <Card className="max-w-2xl">
          <Row label="Name" value={`${p.firstName} ${p.lastName}`} />
          <Row label="Admission no." value={p.admissionNo} />
          <Row
            label="Class / Section"
            value={
              [p.className, p.sectionName].filter(Boolean).join(" · ") || null
            }
          />
          <Row label="Gender" value={p.gender} />
          <Row
            label="Date of birth"
            value={
              p.dateOfBirth
                ? new Date(p.dateOfBirth).toLocaleDateString()
                : null
            }
          />
          <Row label="Guardian" value={p.guardianName} />
          <Row label="Guardian phone" value={p.guardianPhone} />
          <Row label="Guardian email" value={p.guardianEmail} />
          <Row label="Address" value={p.address} />
        </Card>
      )}
    </>
  );
}
