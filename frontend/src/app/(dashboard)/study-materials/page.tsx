"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import {
  Button,
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
import type { Paginated, SchoolClass, Subject } from "@/types";
import { useTerms } from "@/lib/terms";

interface Material {
  id: string;
  classId: string | null;
  className: string | null;
  subjectId: string | null;
  subjectName: string | null;
  title: string;
  description: string | null;
  fileUrl: string;
  createdAt: string;
}

const materialSchema = z.object({
  title: z.string().min(1, "Required"),
  description: z.string().optional(),
  fileUrl: z.string().url("Enter a valid URL"),
  classId: z.string().optional(),
  subjectId: z.string().optional(),
});
type MaterialForm = z.infer<typeof materialSchema>;

export default function StudyMaterialsPage() {
  const term = useTerms();
  const [rows, setRows] = useState<Material[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classFilter, setClassFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const limit = 10;

  useEffect(() => {
    Promise.all([
      api.get<SchoolClass[]>("/classes").catch(() => []),
      api.get<Subject[]>("/subjects").catch(() => []),
    ]).then(([c, s]) => {
      setClasses(c);
      setSubjects(s);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (classFilter) params.set("classId", classFilter);
      if (subjectFilter) params.set("subjectId", subjectFilter);
      if (search) params.set("search", search);
      const result = await api.get<Paginated<Material>>(`/study-materials?${params.toString()}`);
      setRows(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, classFilter, subjectFilter, search]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MaterialForm>({ resolver: zodResolver(materialSchema) });

  const onSubmit = async (values: MaterialForm) => {
    setServerError(null);
    const payload = {
      title: values.title,
      description: values.description || undefined,
      fileUrl: values.fileUrl,
      classId: values.classId || null,
      subjectId: values.subjectId || null,
    };
    try {
      await api.post("/study-materials", payload);
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to save");
    }
  };

  const removeRow = async (m: Material) => {
    if (!confirm(`Delete "${m.title}"?`)) return;
    setRowError(null);
    try {
      await api.delete(`/study-materials/${m.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Study Materials"
        subtitle="Learning resources shared with students"
        action={<Button onClick={() => setModalOpen(true)}>+ Add material</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56">
          <Input
            placeholder="Search title or description…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-44">
          <Select
            value={classFilter}
            onChange={(e) => {
              setClassFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select
            value={subjectFilter}
            onChange={(e) => {
              setSubjectFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No study materials yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">{term.subject}</th>
                <th className="px-4 py-3">Link</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((m) => (
                <tr key={m.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">{m.title}</td>
                  <td className="px-4 py-3 text-muted">{m.className ?? "School-wide"}</td>
                  <td className="px-4 py-3 text-muted">{m.subjectName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <a
                      href={m.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      Open
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => removeRow(m)}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}

      <Modal title="Add study material" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Title" error={errors.title?.message}>
            <Input {...register("title")} />
          </Field>
          <Field label="Link (URL)" error={errors.fileUrl?.message}>
            <Input placeholder="https://…" {...register("fileUrl")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={term.klass}>
              <Select {...register("classId")}>
                <option value="">School-wide</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={term.subject}>
              <Select {...register("subjectId")}>
                <option value="">None</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Textarea rows={2} {...register("description")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
