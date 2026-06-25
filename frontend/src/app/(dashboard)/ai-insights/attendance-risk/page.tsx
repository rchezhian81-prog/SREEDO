"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
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
} from "@/components/ui";
import type { AiAttendanceRisk } from "@/types";
import { useTerms } from "@/lib/terms";

export default function AttendanceRiskPage() {
  const term = useTerms();
  const { can, loading: permsLoading } = usePermissions();
  const allowed = can("ai:risk_alerts");

  const [threshold, setThreshold] = useState("75");
  const [windowDays, setWindowDays] = useState("60");
  const [data, setData] = useState<AiAttendanceRisk | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (threshold.trim()) params.set("threshold", threshold.trim());
      if (windowDays.trim()) params.set("windowDays", windowDays.trim());
      const qs = params.toString();
      setData(
        await api.get<AiAttendanceRisk>(
          `/ai-insights/risk/attendance${qs ? `?${qs}` : ""}`
        )
      );
    } catch (err) {
      setData(null);
      setError(
        err instanceof ApiError ? err.message : "Failed to analyze attendance"
      );
    } finally {
      setLoading(false);
    }
  };

  if (permsLoading) {
    return (
      <>
        <PageHeader title="Attendance risk" />
        <Spinner />
      </>
    );
  }

  if (!allowed) {
    return (
      <>
        <PageHeader title="Attendance risk" />
        <EmptyState message="You don't have permission to view this page." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Attendance risk"
        subtitle="Students below an attendance threshold over a recent window"
      />

      <div className="mb-4">
        <Link
          href="/ai-insights"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to AI Insights
        </Link>
      </div>

      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Field label="Threshold %">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                />
              </Field>
            </div>
            <div className="w-40">
              <Field label="Window (days)">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={windowDays}
                  onChange={(event) => setWindowDays(event.target.value)}
                />
              </Field>
            </div>
            <Button onClick={analyze} disabled={loading}>
              {loading ? "Analyzing…" : "Analyze"}
            </Button>
          </div>
        </Card>

        <ErrorNote message={error} />

        {loading ? (
          <Spinner />
        ) : data ? (
          <>
            <Card>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  <span className="text-2xl font-semibold text-slate-900">
                    {data.count}
                  </span>{" "}
                  student{data.count === 1 ? "" : "s"} below {data.threshold}%
                  over the last {data.windowDays} days.
                </p>
                {!data.aiAvailable && <Badge tone="slate">AI off</Badge>}
              </div>
              {data.narrative ? (
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {data.narrative}
                </p>
              ) : (
                <p className="text-sm text-slate-400">
                  AI narration disabled — showing metrics only.
                </p>
              )}
            </Card>

            {data.students.length > 0 ? (
              <Card>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">{term.admissionNo}</th>
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3">Present / Total</th>
                        <th className="px-4 py-3">Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.students.map((student) => (
                        <tr key={student.studentId}>
                          <td className="px-4 py-3 text-slate-600">
                            {student.admissionNo}
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {student.name}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {student.present} / {student.total}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={student.rate < 50 ? "red" : "amber"}>
                              {student.rate}%
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : (
              <EmptyState message="No students below the threshold — good attendance." />
            )}
          </>
        ) : (
          <EmptyState message="Set a threshold and window, then run the analysis." />
        )}
      </div>
    </>
  );
}
