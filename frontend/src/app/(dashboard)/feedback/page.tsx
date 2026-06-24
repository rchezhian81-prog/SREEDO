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
  Select,
  Spinner,
} from "@/components/ui";
import type { Paginated } from "@/types";

const TYPES = ["feedback", "complaint", "suggestion", "grievance"] as const;
const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

interface FeedbackEntry {
  id: string;
  type: string;
  subject: string;
  message: string;
  submitterName: string | null;
  submitterContact: string | null;
  status: (typeof STATUSES)[number];
  resolution: string | null;
  createdAt: string;
}

function statusTone(s: string): "green" | "amber" | "red" | "slate" | "blue" {
  switch (s) {
    case "resolved":
      return "green";
    case "in_progress":
      return "blue";
    case "closed":
      return "slate";
    default:
      return "amber";
  }
}

const createSchema = z.object({
  type: z.enum(TYPES),
  subject: z.string().min(1, "Required"),
  message: z.string().min(1, "Required"),
  submitterName: z.string().optional(),
  submitterContact: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

const textareaCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-500";

export default function FeedbackPage() {
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [manageFor, setManageFor] = useState<FeedbackEntry | null>(null);
  const [manageStatus, setManageStatus] = useState<string>("open");
  const [manageResolution, setManageResolution] = useState("");
  const [savingManage, setSavingManage] = useState(false);

  const limit = 10;

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      const result = await api.get<Paginated<FeedbackEntry>>(`/feedback?${params.toString()}`);
      setEntries(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, statusFilter, search]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { type: "feedback" },
  });

  const onCreate = async (values: CreateForm) => {
    setServerError(null);
    try {
      await api.post("/feedback", values);
      setCreateOpen(false);
      reset({ type: "feedback" });
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to save");
    }
  };

  const openManage = (entry: FeedbackEntry) => {
    setManageFor(entry);
    setManageStatus(entry.status);
    setManageResolution(entry.resolution ?? "");
  };

  const saveManage = async () => {
    if (!manageFor) return;
    setSavingManage(true);
    setRowError(null);
    try {
      await api.patch(`/feedback/${manageFor.id}`, {
        status: manageStatus,
        resolution: manageResolution || undefined,
      });
      setManageFor(null);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to update");
    } finally {
      setSavingManage(false);
    }
  };

  const removeEntry = async (entry: FeedbackEntry) => {
    if (!confirm("Delete this entry?")) return;
    setRowError(null);
    try {
      await api.delete(`/feedback/${entry.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Feedback & Grievances"
        subtitle="Track complaints, suggestions and grievances to resolution"
        action={<Button onClick={() => setCreateOpen(true)}>+ Log entry</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56">
          <Input
            placeholder="Search subject or submitter…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-40">
          <Select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </Select>
        </div>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <EmptyState message="No feedback entries" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">{e.subject}</td>
                  <td className="px-4 py-3 capitalize text-muted">{e.type}</td>
                  <td className="px-4 py-3 text-muted">{e.submitterName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(e.status)}>{e.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => openManage(e)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
                      >
                        Manage
                      </button>
                      <button
                        onClick={() => removeEntry(e)}
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
          <span className="text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}

      <Modal title="Log feedback / grievance" open={createOpen} onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleSubmit(onCreate)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select {...register("type")}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="From (name)">
              <Input {...register("submitterName")} />
            </Field>
          </div>
          <Field label="Subject" error={errors.subject?.message}>
            <Input {...register("subject")} />
          </Field>
          <Field label="Message" error={errors.message?.message}>
            <textarea rows={4} className={textareaCls} {...register("message")} />
          </Field>
          <Field label="Contact">
            <Input {...register("submitterContact")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        title={manageFor?.subject ?? "Entry"}
        open={manageFor !== null}
        onClose={() => setManageFor(null)}
      >
        {manageFor && (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 text-sm text-muted">
              {manageFor.message}
            </p>
            {manageFor.submitterContact && (
              <p className="text-xs text-faint">Contact: {manageFor.submitterContact}</p>
            )}
            <Field label="Status">
              <Select value={manageStatus} onChange={(e) => setManageStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace("_", " ")}</option>
                ))}
              </Select>
            </Field>
            <Field label="Resolution / notes">
              <textarea
                rows={3}
                className={textareaCls}
                value={manageResolution}
                onChange={(e) => setManageResolution(e.target.value)}
              />
            </Field>
            <ErrorNote message={rowError} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setManageFor(null)}>
                Cancel
              </Button>
              <Button type="button" disabled={savingManage} onClick={saveManage}>
                {savingManage ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
