"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, ErrorNote, Modal, Spinner } from "@/components/ui";
import type { Student } from "@/types";

interface PerfFlag {
  key: string;
  severity: "low" | "medium" | "high";
  detail: string;
  hint: string;
}

interface Performance {
  windowDays: number;
  attendance: { present: number; total: number; rate: number | null };
  exams: { average: number | null; count: number };
  homework: { submitted: number; assigned: number; rate: number | null };
  fees: { outstanding: number };
  discipline: { open: number; total: number };
  flags: PerfFlag[];
  narrative: string | null;
  aiAvailable: boolean;
}

const SEVERITY_TONE = { high: "red", medium: "amber", low: "slate" } as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className="text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

/**
 * Staff dialog: a student's attendance / exam / homework / fee / discipline
 * snapshot with deterministic risk flags + intervention hints. An AI narrative is
 * shown when OpenAI is configured; otherwise the computed flags stand on their own.
 */
export function StudentPerformanceModal({
  student,
  onClose,
}: {
  student: Student | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      setData(
        await api.get<Performance>(
          `/ai-insights/students/${student.id}/performance`
        )
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load performance"
      );
    } finally {
      setLoading(false);
    }
  }, [student]);

  useEffect(() => {
    if (student) void load();
  }, [student, load]);

  const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

  return (
    <Modal
      title={
        student
          ? `Performance · ${student.firstName} ${student.lastName}`
          : "Performance"
      }
      open={student !== null}
      onClose={onClose}
    >
      <div className="space-y-4">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorNote message={error} />
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat
                label="Attendance"
                value={`${pct(data.attendance.rate)} (${data.attendance.present}/${data.attendance.total})`}
              />
              <Stat label="Exam avg" value={pct(data.exams.average)} />
              <Stat label="Homework" value={pct(data.homework.rate)} />
              <Stat label="Fees due" value={String(data.fees.outstanding)} />
              <Stat
                label="Discipline (open)"
                value={String(data.discipline.open)}
              />
              <Stat label="Window" value={`${data.windowDays}d`} />
            </div>

            {data.flags.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
                No risk flags — this student is on track.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.flags.map((f) => (
                  <li
                    key={f.key}
                    className="rounded-lg border border-line bg-surface px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone={SEVERITY_TONE[f.severity]}>
                        {f.severity}
                      </Badge>
                      <span className="text-sm font-medium text-ink">
                        {f.detail}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{f.hint}</p>
                  </li>
                ))}
              </ul>
            )}

            {data.narrative ? (
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="mb-1 text-xs font-semibold uppercase text-muted">
                  AI summary
                </p>
                <p className="whitespace-pre-wrap text-sm text-ink">
                  {data.narrative}
                </p>
              </div>
            ) : (
              <p className="text-xs text-faint">
                {data.aiAvailable
                  ? "AI summary unavailable right now — showing computed flags."
                  : "AI narrative is off (OpenAI not configured); flags are computed locally."}
              </p>
            )}
          </>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
