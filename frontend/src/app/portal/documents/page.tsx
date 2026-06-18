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
  Input,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { DocumentMeta } from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

const CATEGORIES = [
  "profile_photo",
  "id_card",
  "certificate",
  "tc",
  "document",
  "attachment",
] as const;

async function downloadPortalDoc(id: string, filename: string) {
  const res = await fetch(`${BASE}/documents/${id}/download`, {
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

async function uploadPortalDoc(form: FormData): Promise<void> {
  const res = await fetch(`${BASE}/documents`, {
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

function formatKb(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function PortalDocumentsPage() {
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const role = usePortalStore((state) => state.user?.role);
  const isStudent = role === "student";

  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDocs(await portalApi.get<DocumentMeta[]>("/documents"));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load documents."
      );
    } finally {
      setLoading(false);
    }
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
    if (!studentId) {
      setUploadError("No student selected");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("ownerType", "student");
      form.append("ownerId", studentId);
      form.append("category", category);
      await uploadPortalDoc(form);
      setUploadSuccess("Uploaded successfully");
      if (fileRef.current) fileRef.current.value = "";
      await loadDocs();
    } catch (err) {
      setUploadError(
        err instanceof ApiError ? err.message : "Failed to upload document"
      );
    } finally {
      setUploading(false);
    }
  };

  if (!studentId) {
    return (
      <>
        <PageHeader title="Documents" />
        <EmptyState message="No student linked to your account yet." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Documents" subtitle="View and download your files" />

      <div className="space-y-6">
        {isStudent && (
          <Card>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Upload document
            </h2>
            <div className="flex flex-wrap items-end gap-3">
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
        )}

        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorNote message={error} />
        ) : docs.length === 0 ? (
          <EmptyState message="No documents available." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((doc) => (
              <Card key={doc.id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="font-medium text-slate-900">
                    {doc.originalName}
                  </p>
                  <Badge>{doc.category}</Badge>
                </div>
                <p className="text-sm text-slate-500">
                  {formatKb(doc.sizeBytes)}
                </p>
                <p className="text-xs text-slate-400">
                  {new Date(doc.createdAt).toLocaleDateString()}
                </p>
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => downloadPortalDoc(doc.id, doc.originalName)}
                >
                  Download
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
