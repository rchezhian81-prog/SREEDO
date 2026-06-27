"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
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

interface Visitor {
  id: string;
  visitorName: string;
  phone: string | null;
  purpose: string | null;
  whomToMeet: string | null;
  badgeNo: string | null;
  inTime: string;
  outTime: string | null;
}

const visitorSchema = z.object({
  visitorName: z.string().min(1, "Required"),
  phone: z.string().optional(),
  purpose: z.string().optional(),
  whomToMeet: z.string().optional(),
  badgeNo: z.string().optional(),
});
type VisitorForm = z.infer<typeof visitorSchema>;

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export default function FrontOfficePage() {
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeOnly, setActiveOnly] = useState(false);
  const [search, setSearch] = useState("");
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
      if (activeOnly) params.set("active", "true");
      if (search) params.set("search", search);
      const result = await api.get<Paginated<Visitor>>(`/visitors?${params.toString()}`);
      setVisitors(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, activeOnly, search]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<VisitorForm>({ resolver: zodResolver(visitorSchema) });

  const onSubmit = async (values: VisitorForm) => {
    setServerError(null);
    try {
      await api.post("/visitors", values);
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to check in visitor");
    }
  };

  const checkout = async (v: Visitor) => {
    setRowError(null);
    try {
      await api.post(`/visitors/${v.id}/checkout`, {});
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to check out");
    }
  };

  const removeVisitor = async (v: Visitor) => {
    if (!confirm(`Delete the entry for ${v.visitorName}?`)) return;
    setRowError(null);
    try {
      await api.delete(`/visitors/${v.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Front Office"
        subtitle="Visitor check-in / check-out log"
        action={<Button onClick={() => setModalOpen(true)}>+ Check in visitor</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-64">
          <Input
            placeholder="Search name, phone or host…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked);
              setPage(1);
            }}
          />
          Currently inside
        </label>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : visitors.length === 0 ? (
        <EmptyState message="No visitor entries" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Visitor</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">To meet</th>
                <th className="px-4 py-3">In</th>
                <th className="px-4 py-3">Out</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visitors.map((v) => (
                <tr key={v.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{v.visitorName}</span>
                    {v.phone && <span className="block text-xs text-faint">{v.phone}</span>}
                  </td>
                  <td className="px-4 py-3 text-muted">{v.purpose ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{v.whomToMeet ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{fmt(v.inTime)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {v.outTime ? (
                      <span className="text-muted">{fmt(v.outTime)}</span>
                    ) : (
                      <Badge tone="green">inside</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      {!v.outTime && (
                        <button
                          onClick={() => checkout(v)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
                        >
                          Check out
                        </button>
                      )}
                      <button
                        onClick={() => removeVisitor(v)}
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
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
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}

      <Modal title="Check in visitor" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Visitor name" error={errors.visitorName?.message}>
            <Input {...register("visitorName")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <Input {...register("phone")} />
            </Field>
            <Field label="Badge no">
              <Input {...register("badgeNo")} />
            </Field>
          </div>
          <Field label="Purpose">
            <Input placeholder="e.g. Admission enquiry" {...register("purpose")} />
          </Field>
          <Field label="Whom to meet">
            <Input {...register("whomToMeet")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Check in"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
