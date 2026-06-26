"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  cx,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { AttendanceRow, SchoolClass } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useTerms } from "@/lib/terms";

const STATUSES = ["present", "absent", "late", "excused"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_STYLES: Record<Status, string> = {
  present: "bg-emerald-600 text-white",
  absent: "bg-red-600 text-white",
  late: "bg-amber-500 text-white",
  excused: "bg-blue-600 text-white",
};

interface SectionOption {
  id: string;
  label: string;
}

export default function AttendancePage() {
  const term = useTerms();
  const { t } = useI18n();
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [date, setDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SchoolClass[]>("/classes")
      .then((classes) => {
        const options = classes.flatMap((schoolClass) =>
          schoolClass.sections.map((section) => ({
            id: section.id,
            label: `${schoolClass.name} — ${section.name}`,
          }))
        );
        setSections(options);
        if (options[0]) setSectionId(options[0].id);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.get<{ records: AttendanceRow[] }>(
        `/attendance?sectionId=${sectionId}&date=${date}`
      );
      setRows(result.records);
    } finally {
      setLoading(false);
    }
  }, [sectionId, date]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const setStatus = (studentId: string, status: Status) => {
    setRows((current) =>
      current.map((row) =>
        row.studentId === studentId ? { ...row, status } : row
      )
    );
  };

  const markAll = (status: Status) => {
    setRows((current) => current.map((row) => ({ ...row, status })));
  };

  const save = async () => {
    const records = rows
      .filter((row) => row.status !== null)
      .map((row) => ({ studentId: row.studentId, status: row.status as Status }));
    if (records.length === 0) {
      setError("Mark at least one student first");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api.post<{ upserted: number }>("/attendance", {
        date,
        records,
      });
      setMessage(`Saved attendance for ${result.upserted} students`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("pages.attendance.title")}
        subtitle={t("pages.attendance.subtitle")}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <span className="mb-1 block text-sm font-medium text-ink">
            Section
          </span>
          <Select
            value={sectionId}
            onChange={(event) => setSectionId(event.target.value)}
          >
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <span className="mb-1 block text-sm font-medium text-ink">
            Date
          </span>
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <Button variant="secondary" onClick={() => markAll("present")}>
          All present
        </Button>
        <Button onClick={save} disabled={saving || rows.length === 0}>
          {saving ? "Saving…" : "Save attendance"}
        </Button>
      </div>

      {message && (
        <p className="mb-3 rounded-lg bg-emerald-500/12 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
          {message}
        </p>
      )}
      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No active students in this section" />
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">{term.admissionNo}</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.studentId}>
                  <td className="px-4 py-3 font-medium text-ink">
                    {row.firstName} {row.lastName}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {row.admissionNo}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {STATUSES.map((status) => (
                        <button
                          key={status}
                          onClick={() => setStatus(row.studentId, status)}
                          className={cx(
                            "rounded-full px-3 py-1 text-xs font-medium capitalize transition",
                            row.status === status
                              ? STATUS_STYLES[status]
                              : "bg-hover text-muted hover:bg-hover"
                          )}
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
