"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { ApiError } from "@/lib/api";
import { usePortalStore } from "@/stores/portal-store";
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
import type { Homework, HomeworkAttachment, HomeworkDetail } from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

function statusTone(status: string): "slate" | "green" | "amber" | "red" | "blue" {
  switch (status) {
    case "completed":
    case "reviewed":
      return "green";
    case "submitted":
      return "blue";
    case "late":
      return "amber";
    case "resubmit":
      return "red";
    default:
      return "slate";
  }
}

async function downloadPortalDoc(id: string, filename: string) {
  const res = await fetch(`${BASE}/homework/attachments/${id}/download`, {
    credentials: "include",
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function submitPortalHomework(
  id: string,
  form: FormData
): Promise<void> {
  const res = await fetch(`${BASE}/homework/${id}/submit`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    let m = res.statusText;
    try {
      const d = await res.json();
      if (typeof d.error === "string") m = d.error;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, m);
  }
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export default function PortalHomeworkPage() {
  const role = usePortalStore((state) => state.user?.role);
  const isStudent = role === "student";

  const [list, setList] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await portalApi.get<Homework[]>("/homework"));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load homework."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  return (
    <>
      <PageHeader title="Homework" subtitle="Assignments and submissions" />

      {selectedId ? (
        <PortalHomeworkDetail
          homeworkId={selectedId}
          isStudent={isStudent}
          onBack={() => setSelectedId(null)}
        />
      ) : loading ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : list.length === 0 ? (
        <EmptyState message="No homework assigned yet." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((homework) => (
            <Card
              key={homework.id}
              className="cursor-pointer transition hover:ring-1 hover:ring-brand-200"
            >
              <button
                onClick={() => setSelectedId(homework.id)}
                className="block w-full text-left"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="font-medium text-slate-900">{homework.title}</p>
                  {homework.attachmentCount > 0 && (
                    <Badge>📎 {homework.attachmentCount}</Badge>
                  )}
                </div>
                <p className="text-sm text-slate-500">
                  {homework.subjectName ?? "—"}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Due {formatDate(homework.dueDate)}
                </p>
              </button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function PortalHomeworkDetail({
  homeworkId,
  isStudent,
  onBack,
}: {
  homeworkId: string;
  isStudent: boolean;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<HomeworkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await portalApi.get<HomeworkDetail>(`/homework/${homeworkId}`));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load homework."
      );
    } finally {
      setLoading(false);
    }
  }, [homeworkId]);

  useEffect(() => {
    load();
  }, [load]);

  const onDownload = (attachment: HomeworkAttachment) =>
    downloadPortalDoc(attachment.id, attachment.originalName);

  const onSubmit = async () => {
    setSubmitError(null);
    setSubmitSuccess(null);
    const file = fileRef.current?.files?.[0];
    if (!content.trim() && !file) {
      setSubmitError("Add a response or attach a file.");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      if (content.trim()) fd.append("content", content.trim());
      if (file) fd.append("file", file);
      await submitPortalHomework(homeworkId, fd);
      setContent("");
      if (fileRef.current) fileRef.current.value = "";
      setSubmitSuccess("Submitted successfully");
      await load();
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : "Failed to submit homework"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!detail) return <EmptyState message="Homework not found." />;

  const submission = detail.submission;

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="text-sm font-medium text-brand-600 hover:text-brand-700"
      >
        ← Back to homework
      </button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {detail.title}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {detail.subjectName ?? "—"}
            </p>
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>Due {formatDate(detail.dueDate)}</p>
            {detail.maxMarks && <p>Max marks: {detail.maxMarks}</p>}
          </div>
        </div>
        {detail.description && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-slate-700">Description</h3>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-600">
              {detail.description}
            </p>
          </div>
        )}
        {detail.instructions && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-slate-700">
              Instructions
            </h3>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-600">
              {detail.instructions}
            </p>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          Attachments
        </h2>
        {detail.attachments.length === 0 ? (
          <EmptyState message="No attachments." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {detail.attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
              >
                <span className="truncate text-sm font-medium text-slate-700">
                  {attachment.originalName}
                </span>
                <button
                  onClick={() => onDownload(attachment)}
                  className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {submission && (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              Your submission
            </h2>
            <Badge tone={statusTone(submission.status)}>
              {submission.status}
            </Badge>
          </div>
          {submission.content && (
            <p className="whitespace-pre-line text-sm text-slate-600">
              {submission.content}
            </p>
          )}
          <div className="mt-3 grid gap-1 text-sm text-slate-500">
            <p>
              Submitted{" "}
              {submission.submittedAt
                ? new Date(submission.submittedAt).toLocaleString()
                : "—"}
            </p>
            {submission.marks && <p>Marks: {submission.marks}</p>}
            {submission.remarks && <p>Remarks: {submission.remarks}</p>}
          </div>
        </Card>
      )}

      {isStudent && (
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            {submission ? "Resubmit" : "Submit homework"}
          </h2>
          <div className="space-y-4">
            <Field label="Response">
              <Textarea
                rows={4}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </Field>
            <Field label="Attachment (optional)">
              <Input type="file" ref={fileRef} />
            </Field>
            {submitSuccess && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {submitSuccess}
              </p>
            )}
            <ErrorNote message={submitError} />
            <div className="flex justify-end">
              <Button onClick={onSubmit} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit"}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
