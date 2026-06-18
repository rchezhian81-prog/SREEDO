"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import type {
  Homework,
  HomeworkAttachment,
  HomeworkDetail,
  HomeworkSubmission,
  SchoolClass,
  Subject,
} from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

const REVIEW_STATUSES = [
  "submitted",
  "reviewed",
  "completed",
  "late",
  "resubmit",
] as const;

interface SectionOption {
  id: string;
  label: string;
}

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

async function uploadForm(path: string, form: FormData): Promise<unknown> {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  return res.json();
}

async function downloadDoc(id: string, filename: string) {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`${BASE}/homework/attachments/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatKb(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

interface HomeworkForm {
  sectionId: string;
  subjectId: string;
  title: string;
  description: string;
  instructions: string;
  dueDate: string;
  maxMarks: string;
}

const emptyForm: HomeworkForm = {
  sectionId: "",
  subjectId: "",
  title: "",
  description: "",
  instructions: "",
  dueDate: "",
  maxMarks: "",
};

export default function HomeworkPage() {
  const role = useAuthStore((state) => state.user?.role);
  const canManage = role === "admin" || role === "teacher";

  const [sections, setSections] = useState<SectionOption[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [list, setList] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [filterSection, setFilterSection] = useState("");
  const [filterSubject, setFilterSubject] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create / edit modal.
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Homework | null>(null);
  const [form, setForm] = useState<HomeworkForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadSelectors = useCallback(() => {
    return Promise.all([
      api.get<SchoolClass[]>("/classes").then((classes) =>
        setSections(
          classes.flatMap((schoolClass) =>
            schoolClass.sections.map((section) => ({
              id: section.id,
              label: `${schoolClass.name} - ${section.name}`,
            }))
          )
        )
      ),
      api.get<Subject[]>("/subjects").then(setSubjects),
    ]);
  }, []);

  const loadList = useCallback(async () => {
    setListError(null);
    const params = new URLSearchParams();
    if (filterSection) params.set("sectionId", filterSection);
    if (filterSubject) params.set("subjectId", filterSubject);
    const query = params.toString();
    try {
      setList(await api.get<Homework[]>(`/homework${query ? `?${query}` : ""}`));
    } catch (err) {
      setListError(
        err instanceof ApiError ? err.message : "Failed to load homework"
      );
    }
  }, [filterSection, filterSubject]);

  useEffect(() => {
    setLoading(true);
    loadSelectors()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [loadSelectors]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (homework: Homework) => {
    setEditing(homework);
    setFormError(null);
    setForm({
      sectionId: homework.sectionId,
      subjectId: homework.subjectId,
      title: homework.title,
      description: homework.description ?? "",
      instructions: homework.instructions ?? "",
      dueDate: homework.dueDate ? homework.dueDate.slice(0, 10) : "",
      maxMarks: homework.maxMarks ?? "",
    });
    setModalOpen(true);
  };

  const saveHomework = async () => {
    setFormError(null);
    if (!editing && !form.sectionId) {
      setFormError("Select a section");
      return;
    }
    if (!form.subjectId) {
      setFormError("Select a subject");
      return;
    }
    if (!form.title.trim()) {
      setFormError("Title is required");
      return;
    }
    setSaving(true);
    try {
      const common = {
        subjectId: form.subjectId,
        title: form.title.trim(),
        description: form.description || undefined,
        instructions: form.instructions || undefined,
        dueDate: form.dueDate || undefined,
        maxMarks: form.maxMarks || undefined,
      };
      if (editing) {
        await api.patch(`/homework/${editing.id}`, common);
      } else {
        await api.post("/homework", { sectionId: form.sectionId, ...common });
      }
      setModalOpen(false);
      setForm(emptyForm);
      await loadList();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save homework"
      );
    } finally {
      setSaving(false);
    }
  };

  const removeHomework = async (homework: Homework) => {
    if (!confirm(`Delete "${homework.title}"?`)) return;
    try {
      await api.delete(`/homework/${homework.id}`);
      if (selectedId === homework.id) setSelectedId(null);
      await loadList();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete homework");
    }
  };

  return (
    <>
      <PageHeader
        title="Homework"
        subtitle="Assignments, attachments & submissions"
        action={
          !selectedId && canManage ? (
            <Button onClick={openCreate}>+ New homework</Button>
          ) : undefined
        }
      />

      {loading ? (
        <Spinner />
      ) : selectedId ? (
        <HomeworkDetailView
          homeworkId={selectedId}
          canManage={canManage}
          onBack={() => setSelectedId(null)}
        />
      ) : (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Section
                </span>
                <Select
                  value={filterSection}
                  onChange={(event) => setFilterSection(event.target.value)}
                >
                  <option value="">All sections</option>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-56">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Subject
                </span>
                <Select
                  value={filterSubject}
                  onChange={(event) => setFilterSubject(event.target.value)}
                >
                  <option value="">All subjects</option>
                  {subjects.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Homework
            </h2>
            <ErrorNote message={listError} />
            {list.length === 0 ? (
              <EmptyState message="No homework found" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Title</th>
                      <th className="px-4 py-3">Class / Section</th>
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-4 py-3">Due</th>
                      <th className="px-4 py-3">Submissions</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {list.map((homework) => (
                      <tr key={homework.id}>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {homework.title}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {homework.className && homework.sectionName
                            ? `${homework.className} - ${homework.sectionName}`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {homework.subjectName ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {formatDate(homework.dueDate)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {homework.submissionCount} submissions
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => setSelectedId(homework.id)}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              View
                            </button>
                            {canManage && (
                              <button
                                onClick={() => openEdit(homework)}
                                className="text-xs font-medium text-brand-600 hover:text-brand-700"
                              >
                                Edit
                              </button>
                            )}
                            {canManage && (
                              <button
                                onClick={() => removeHomework(homework)}
                                className="text-xs font-medium text-red-600 hover:text-red-700"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal
        title={editing ? "Edit homework" : "New homework"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <div className="space-y-4">
          {!editing && (
            <Field label="Section">
              <Select
                value={form.sectionId}
                onChange={(event) =>
                  setForm({ ...form, sectionId: event.target.value })
                }
              >
                <option value="">Select section…</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Subject">
            <Select
              value={form.subjectId}
              onChange={(event) =>
                setForm({ ...form, subjectId: event.target.value })
              }
            >
              <option value="">Select subject…</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title">
            <Input
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </Field>
          <Field label="Instructions">
            <Textarea
              rows={3}
              value={form.instructions}
              onChange={(event) =>
                setForm({ ...form, instructions: event.target.value })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date">
              <Input
                type="date"
                value={form.dueDate}
                onChange={(event) =>
                  setForm({ ...form, dueDate: event.target.value })
                }
              />
            </Field>
            <Field label="Max marks">
              <Input
                type="number"
                min={0}
                value={form.maxMarks}
                onChange={(event) =>
                  setForm({ ...form, maxMarks: event.target.value })
                }
              />
            </Field>
          </div>
          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={saveHomework} disabled={saving}>
              {saving ? "Saving…" : "Save homework"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function HomeworkDetailView({
  homeworkId,
  canManage,
  onBack,
}: {
  homeworkId: string;
  canManage: boolean;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<HomeworkDetail | null>(null);
  const [submissions, setSubmissions] = useState<HomeworkSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Review modal.
  const [reviewing, setReviewing] = useState<HomeworkSubmission | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string>("reviewed");
  const [reviewMarks, setReviewMarks] = useState("");
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, subs] = await Promise.all([
        api.get<HomeworkDetail>(`/homework/${homeworkId}`),
        api.get<HomeworkSubmission[]>(`/homework/${homeworkId}/submissions`),
      ]);
      setDetail(d);
      setSubmissions(subs);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load homework"
      );
    } finally {
      setLoading(false);
    }
  }, [homeworkId]);

  useEffect(() => {
    load();
  }, [load]);

  const onAddAttachment = async () => {
    setUploadError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadError("Choose a file first");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await uploadForm(`/homework/${homeworkId}/attachments`, fd);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : "Failed to upload attachment"
      );
    } finally {
      setUploading(false);
    }
  };

  const onDownload = async (attachment: HomeworkAttachment) => {
    try {
      await downloadDoc(attachment.id, attachment.originalName);
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Failed to download attachment"
      );
    }
  };

  const openReview = (submission: HomeworkSubmission) => {
    setReviewing(submission);
    setReviewError(null);
    setReviewStatus(submission.status || "reviewed");
    setReviewMarks(submission.marks ?? "");
    setReviewRemarks(submission.remarks ?? "");
  };

  const saveReview = async () => {
    if (!reviewing) return;
    setReviewError(null);
    setReviewSaving(true);
    try {
      await api.post(`/homework/submissions/${reviewing.id}/review`, {
        status: reviewStatus,
        marks: reviewMarks || undefined,
        remarks: reviewRemarks || undefined,
      });
      setReviewing(null);
      await load();
    } catch (err) {
      setReviewError(
        err instanceof ApiError ? err.message : "Failed to save review"
      );
    } finally {
      setReviewSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!detail) return <EmptyState message="Homework not found" />;

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
              {detail.className && detail.sectionName
                ? `${detail.className} - ${detail.sectionName}`
                : "—"}
              {detail.subjectName ? ` · ${detail.subjectName}` : ""}
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
          <EmptyState message="No attachments yet" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="px-4 py-3">Added</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.attachments.map((attachment) => (
                  <tr key={attachment.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {attachment.originalName}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {attachment.mimeType}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatKb(attachment.sizeBytes)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatDate(attachment.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onDownload(attachment)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManage && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="w-72">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Add attachment
              </span>
              <Input type="file" ref={fileRef} />
            </div>
            <Button onClick={onAddAttachment} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            <div className="w-full">
              <ErrorNote message={uploadError} />
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          Submissions
        </h2>
        {submissions.length === 0 ? (
          <EmptyState message="No submissions yet" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Marks</th>
                  <th className="px-4 py-3">Files</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {submissions.map((submission) => (
                  <tr key={submission.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {submission.studentName}
                      <span className="block text-xs font-normal text-slate-400">
                        {submission.admissionNo}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(submission.status)}>
                        {submission.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {submission.marks ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {submission.attachmentCount}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {submission.submittedAt
                        ? new Date(submission.submittedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage && (
                        <button
                          onClick={() => openReview(submission)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Review
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        title="Review submission"
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
      >
        <div className="space-y-4">
          <Field label="Status">
            <Select
              value={reviewStatus}
              onChange={(event) => setReviewStatus(event.target.value)}
            >
              {REVIEW_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Marks">
            <Input
              type="number"
              min={0}
              value={reviewMarks}
              onChange={(event) => setReviewMarks(event.target.value)}
            />
          </Field>
          <Field label="Remarks">
            <Textarea
              rows={3}
              value={reviewRemarks}
              onChange={(event) => setReviewRemarks(event.target.value)}
            />
          </Field>
          <ErrorNote message={reviewError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setReviewing(null)}
            >
              Cancel
            </Button>
            <Button onClick={saveReview} disabled={reviewSaving}>
              {reviewSaving ? "Saving…" : "Save review"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
