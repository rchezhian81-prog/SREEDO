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

interface Visit {
  id: string;
  patientName: string;
  studentId: string | null;
  visitDate: string;
  complaint: string | null;
  treatment: string | null;
  temperature: string | null;
  remarks: string | null;
}

const visitSchema = z.object({
  patientName: z.string().min(1, "Required"),
  visitDate: z.string().min(1, "Required"),
  complaint: z.string().optional(),
  treatment: z.string().optional(),
  temperature: z.string().optional(),
  remarks: z.string().optional(),
});
type VisitForm = z.infer<typeof visitSchema>;

export default function InfirmaryPage() {
  const today = new Date().toISOString().slice(0, 10);

  const [visits, setVisits] = useState<Visit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
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
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const result = await api.get<Paginated<Visit>>(`/infirmary/visits?${params.toString()}`);
      setVisits(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, search, dateFrom, dateTo]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<VisitForm>({
    resolver: zodResolver(visitSchema),
    defaultValues: { visitDate: today },
  });

  const onSubmit = async (values: VisitForm) => {
    setServerError(null);
    try {
      await api.post("/infirmary/visits", values);
      setModalOpen(false);
      reset({ visitDate: today });
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to save visit");
    }
  };

  const removeVisit = async (v: Visit) => {
    if (!confirm(`Delete the visit for ${v.patientName}?`)) return;
    setRowError(null);
    try {
      await api.delete(`/infirmary/visits/${v.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Infirmary"
        subtitle="Clinic / health visit records"
        action={<Button onClick={() => setModalOpen(true)}>+ New visit</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56">
          <Input
            placeholder="Search patient or complaint…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-40">
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        </div>
        <div className="w-40">
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </div>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : visits.length === 0 ? (
        <EmptyState message="No visits recorded" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">Complaint</th>
                <th className="px-4 py-3">Treatment</th>
                <th className="px-4 py-3">Temp</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visits.map((v) => (
                <tr key={v.id} className="hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{v.visitDate}</td>
                  <td className="px-4 py-3 font-medium text-ink">{v.patientName}</td>
                  <td className="px-4 py-3 text-muted">{v.complaint ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{v.treatment ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{v.temperature ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => removeVisit(v)}
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

      <Modal title="New clinic visit" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Patient name" error={errors.patientName?.message}>
              <Input {...register("patientName")} />
            </Field>
            <Field label="Date" error={errors.visitDate?.message}>
              <Input type="date" {...register("visitDate")} />
            </Field>
          </div>
          <Field label="Complaint">
            <Input {...register("complaint")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Treatment">
              <Input {...register("treatment")} />
            </Field>
            <Field label="Temperature">
              <Input placeholder="e.g. 98.6" {...register("temperature")} />
            </Field>
          </div>
          <Field label="Remarks">
            <Input {...register("remarks")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save visit"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
