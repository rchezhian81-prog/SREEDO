"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { ApiError } from "@/lib/api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { Exam } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

async function downloadPortalPdf(path: string, filename: string) {
  const base =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const res = await fetch(`${base}${path}`, { credentials: "include" });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") msg = d.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PortalReportsPage() {
  const { t } = useI18n();
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    portalApi
      .get<Exam[]>("/exams")
      .then(setExams)
      .catch(() => setError("Could not load exams."))
      .finally(() => setLoading(false));
  }, []);

  const downloadReportCard = async () => {
    if (!studentId) return;
    if (!examId) {
      setError("Select an exam first");
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      await downloadPortalPdf(
        `/reports/report-card?examId=${examId}&studentId=${studentId}`,
        "report-card.pdf"
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No results recorded for this exam"
      );
    } finally {
      setDownloading(false);
    }
  };

  if (!studentId) {
    return (
      <>
        <PageHeader title={t("portalPages.reports.title")} />
        <EmptyState message="No student linked to your account yet." />
      </>
    );
  }

  if (loading) return <Spinner />;

  return (
    <>
      <PageHeader
        title={t("portalPages.reports.title")}
        subtitle="Download a report card for an exam"
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Exam
            </span>
            <Select
              value={examId}
              onChange={(event) => setExamId(event.target.value)}
            >
              <option value="">Select exam…</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.name}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={downloadReportCard} disabled={downloading}>
            {downloading ? "Downloading…" : "Download report card"}
          </Button>
        </div>
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      </Card>
    </>
  );
}
