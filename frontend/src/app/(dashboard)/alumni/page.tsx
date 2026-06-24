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
  Spinner,
} from "@/components/ui";
import type { Paginated } from "@/types";

interface Alumnus {
  id: string;
  fullName: string;
  batchYear: number;
  email: string | null;
  phone: string | null;
  currentCompany: string | null;
  currentRole: string | null;
  location: string | null;
  higherEducation: string | null;
  notes: string | null;
}

const currentYear = new Date().getFullYear();

const alumniSchema = z.object({
  fullName: z.string().min(1, "Required"),
  batchYear: z.coerce
    .number({ invalid_type_error: "Year required" })
    .int()
    .min(1900, "Invalid year")
    .max(2100, "Invalid year"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  currentCompany: z.string().optional(),
  currentRole: z.string().optional(),
  location: z.string().optional(),
  higherEducation: z.string().optional(),
  notes: z.string().optional(),
});
type AlumniForm = z.infer<typeof alumniSchema>;

export default function AlumniPage() {
  const [rows, setRows] = useState<Alumnus[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [batchYear, setBatchYear] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const limit = 10;

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      if (batchYear) params.set("batchYear", batchYear);
      const result = await api.get<Paginated<Alumnus>>(`/alumni?${params.toString()}`);
      setRows(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, search, batchYear]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AlumniForm>({
    resolver: zodResolver(alumniSchema),
  });

  const onSubmit = async (values: AlumniForm) => {
    setServerError(null);
    try {
      await api.post("/alumni", values);
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to save");
    }
  };

  const removeRow = async (a: Alumnus) => {
    if (!confirm(`Remove ${a.fullName} from the alumni directory?`)) return;
    setRowError(null);
    try {
      await api.delete(`/alumni/${a.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Alumni"
        subtitle="Alumni & placement directory"
        action={<Button onClick={() => setModalOpen(true)}>+ Add alumnus</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-64">
          <Input
            placeholder="Search name, company or email…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-40">
          <Input
            type="number"
            placeholder={`Batch year (e.g. ${currentYear})`}
            value={batchYear}
            onChange={(e) => {
              setBatchYear(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No alumni recorded" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">{a.fullName}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{a.batchYear}</td>
                  <td className="px-4 py-3 text-muted">{a.currentCompany ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{a.currentRole ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{a.location ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{a.email ?? a.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => removeRow(a)}
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

      <Modal title="Add alumnus" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name" error={errors.fullName?.message}>
              <Input {...register("fullName")} />
            </Field>
            <Field label="Batch year" error={errors.batchYear?.message}>
              <Input type="number" placeholder={String(currentYear)} {...register("batchYear")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" {...register("email")} />
            </Field>
            <Field label="Phone">
              <Input {...register("phone")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current company">
              <Input {...register("currentCompany")} />
            </Field>
            <Field label="Current role">
              <Input {...register("currentRole")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location">
              <Input {...register("location")} />
            </Field>
            <Field label="Higher education">
              <Input {...register("higherEducation")} />
            </Field>
          </div>
          <Field label="Notes">
            <Input {...register("notes")} />
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
