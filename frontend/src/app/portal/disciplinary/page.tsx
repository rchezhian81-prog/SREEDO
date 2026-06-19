"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { ApiError } from "@/lib/api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Badge,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Spinner,
} from "@/components/ui";
import type {
  DisciplinaryRecord,
  DisciplinarySeverity,
  DisciplinaryStatus,
} from "@/types";

const STATUS_LABELS: Record<DisciplinaryStatus, string> = {
  open: "Open",
  under_review: "Under review",
  action_taken: "Action taken",
  closed: "Closed",
  cancelled: "Cancelled",
};

function severityTone(
  severity: DisciplinarySeverity
): "red" | "amber" | "slate" {
  if (severity === "critical" || severity === "high") return "red";
  if (severity === "medium") return "amber";
  return "slate";
}

function statusTone(
  status: DisciplinaryStatus
): "slate" | "green" | "amber" | "red" | "blue" {
  switch (status) {
    case "open":
      return "blue";
    case "under_review":
      return "amber";
    case "action_taken":
      return "green";
    case "closed":
      return "slate";
    case "cancelled":
      return "red";
    default:
      return "slate";
  }
}

export default function PortalDisciplinaryPage() {
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const [records, setRecords] = useState<DisciplinaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!studentId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setUnavailable(false);
    portalApi
      .get<DisciplinaryRecord[]>(`/portal/students/${studentId}/disciplinary`)
      .then(setRecords)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setUnavailable(true);
        } else {
          setError("Could not load disciplinary records.");
        }
      })
      .finally(() => setLoading(false));
  }, [studentId]);

  if (!studentId) {
    return (
      <>
        <PageHeader title="Disciplinary" />
        <EmptyState message="No student linked to your account yet." />
      </>
    );
  }

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Disciplinary"
        subtitle="Recorded incidents & follow-up"
      />

      <ErrorNote message={error} />

      {unavailable ? (
        <EmptyState message="Disciplinary records are not available in the portal." />
      ) : records.length === 0 ? (
        <EmptyState message="No disciplinary records." />
      ) : (
        <div className="space-y-4">
          {records.map((record) => (
            <Card key={record.id}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">
                    {record.category}
                  </p>
                  <p className="text-xs text-slate-400">
                    {record.incidentDate}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={severityTone(record.severity)}>
                    {record.severity}
                  </Badge>
                  <Badge tone={statusTone(record.status)}>
                    {STATUS_LABELS[record.status]}
                  </Badge>
                </div>
              </div>
              {record.description && (
                <p className="mt-2 text-sm text-slate-600">
                  {record.description}
                </p>
              )}
              {record.actionTaken && (
                <p className="mt-2 text-sm text-slate-600">
                  <span className="font-medium text-slate-700">
                    Action taken:{" "}
                  </span>
                  {record.actionTaken}
                </p>
              )}
              {record.followUpDate && (
                <p className="mt-1 text-xs text-slate-400">
                  Follow-up: {record.followUpDate}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
