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
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { DocumentMeta, Paginated, Student } from "@/types";
import { useI18n } from "@/i18n/I18nProvider";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

const CATEGORIES = [
  "profile_photo",
  "id_card",
  "certificate",
  "tc",
  "document",
  "attachment",
] as const;

type OwnerTarget = "student" | "user" | "logo";

async function uploadDoc(path: string, form: FormData): Promise<unknown> {
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
  const res = await fetch(`${BASE}/documents/${id}/download`, {
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

export default function DocumentsPage() {
  const { t } = useI18n();
  const role = useAuthStore((state) => state.user?.role);
  const isAdmin = role === "admin";

  const [students, setStudents] = useState<Student[]>([]);
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Upload form state.
  const [target, setTarget] = useState<OwnerTarget>("student");
  const [studentId, setStudentId] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Logo state.
  const [logo, setLogo] = useState<DocumentMeta | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoSuccess, setLogoSuccess] = useState<string | null>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    setListError(null);
    const params = new URLSearchParams();
    if (target === "student" && studentId) {
      params.set("ownerType", "student");
      params.set("ownerId", studentId);
    }
    const query = params.toString();
    try {
      setDocs(
        await api.get<DocumentMeta[]>(`/documents${query ? `?${query}` : ""}`)
      );
    } catch (err) {
      setListError(
        err instanceof ApiError ? err.message : "Failed to load documents"
      );
    }
  }, [target, studentId]);

  const loadLogo = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const list = await api.get<DocumentMeta[]>(
        "/documents?ownerType=institution&category=logo"
      );
      setLogo(list[0] ?? null);
    } catch {
      setLogo(null);
    }
  }, [isAdmin]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api
        .get<Paginated<Student>>("/students?limit=100")
        .then((res) => setStudents(res.data))
        .catch(() => undefined),
      loadLogo(),
    ]).finally(() => setLoading(false));
    // Load students + logo once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const onUpload = async () => {
    setUploadError(null);
    setUploadSuccess(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadError("Choose a file first");
      return;
    }
    if (target === "student" && !studentId) {
      setUploadError("Select a student first");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (target === "logo") {
        await uploadDoc("/documents/logo", form);
      } else {
        form.append("ownerType", target === "student" ? "student" : "user");
        if (target === "student") form.append("ownerId", studentId);
        form.append("category", category);
        await uploadDoc("/documents", form);
      }
      setUploadSuccess("Uploaded successfully");
      if (fileRef.current) fileRef.current.value = "";
      if (target === "logo") {
        await loadLogo();
      } else {
        await loadDocs();
      }
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : "Failed to upload document"
      );
    } finally {
      setUploading(false);
    }
  };

  const onDownload = async (doc: DocumentMeta) => {
    try {
      await downloadDoc(doc.id, doc.originalName);
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Failed to download document"
      );
    }
  };

  const onDelete = async (doc: DocumentMeta) => {
    if (!confirm(`Delete "${doc.originalName}"?`)) return;
    try {
      await api.delete(`/documents/${doc.id}`);
      await loadDocs();
      await loadLogo();
    } catch (err) {
      alert(
        err instanceof ApiError ? err.message : "Failed to delete document"
      );
    }
  };

  const onUploadLogo = async () => {
    setLogoError(null);
    setLogoSuccess(null);
    const file = logoFileRef.current?.files?.[0];
    if (!file) {
      setLogoError("Choose a logo image first");
      return;
    }
    setLogoUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await uploadDoc("/documents/logo", form);
      setLogoSuccess("Logo updated");
      if (logoFileRef.current) logoFileRef.current.value = "";
      await loadLogo();
    } catch (err) {
      setLogoError(
        err instanceof ApiError ? err.message : "Failed to update logo"
      );
    } finally {
      setLogoUploading(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t("pages.documents.title")}
        subtitle={t("pages.documents.subtitle")}
      />

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Upload document
            </h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-56">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  Attach to
                </span>
                <Select
                  value={target}
                  onChange={(event) =>
                    setTarget(event.target.value as OwnerTarget)
                  }
                >
                  <option value="student">Student</option>
                  <option value="user">My profile</option>
                  {isAdmin && <option value="logo">Institution logo</option>}
                </Select>
              </div>

              {target === "student" && (
                <div className="w-72">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Student
                  </span>
                  <Select
                    value={studentId}
                    onChange={(event) => setStudentId(event.target.value)}
                  >
                    <option value="">Select student…</option>
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.firstName} {student.lastName} (
                        {student.admissionNo})
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              {target !== "logo" && (
                <div className="w-56">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Category
                  </span>
                  <Select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div className="w-72">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  File
                </span>
                <Input type="file" ref={fileRef} />
              </div>

              <Button onClick={onUpload} disabled={uploading}>
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              <ErrorNote message={uploadError} />
              {uploadSuccess && (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {uploadSuccess}
                </p>
              )}
            </div>
          </Card>

          {isAdmin && (
            <Card>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">
                Institution logo
              </h2>
              <p className="mb-3 text-sm text-slate-600">
                {logo ? (
                  <>
                    Current logo:{" "}
                    <span className="font-medium text-slate-900">
                      {logo.originalName}
                    </span>
                  </>
                ) : (
                  "No logo uploaded yet."
                )}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-72">
                  <span className="mb-1 block text-sm font-medium text-slate-700">
                    Logo image
                  </span>
                  <Input type="file" ref={logoFileRef} accept="image/*" />
                </div>
                <Button onClick={onUploadLogo} disabled={logoUploading}>
                  {logoUploading ? "Uploading…" : "Upload logo"}
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                <ErrorNote message={logoError} />
                {logoSuccess && (
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    {logoSuccess}
                  </p>
                )}
              </div>
            </Card>
          )}

          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              {target === "student" && studentId
                ? "Student documents"
                : "All documents"}
            </h2>
            <ErrorNote message={listError} />
            {docs.length === 0 ? (
              <EmptyState message="No documents found" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Size</th>
                      <th className="px-4 py-3">Uploaded</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {docs.map((doc) => (
                      <tr key={doc.id}>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {doc.originalName}
                        </td>
                        <td className="px-4 py-3">
                          <Badge>{doc.category}</Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {doc.mimeType}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatKb(doc.sizeBytes)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {new Date(doc.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => onDownload(doc)}
                              className="text-xs font-medium text-brand-600 hover:text-brand-700"
                            >
                              Download
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => onDelete(doc)}
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
    </>
  );
}
