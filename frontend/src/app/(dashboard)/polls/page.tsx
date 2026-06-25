"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import type { Paginated, SchoolClass } from "@/types";
import { useTerms } from "@/lib/terms";

interface Poll {
  id: string;
  question: string;
  className: string | null;
  isPublished: boolean;
  totalVotes: number;
}

export default function PollsPage() {
  const term = useTerms();
  const [rows, setRows] = useState<Poll[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  // create form state
  const [question, setQuestion] = useState("");
  const [classId, setClassId] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const limit = 10;

  useEffect(() => {
    api.get<SchoolClass[]>("/classes").then(setClasses).catch(() => setClasses([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const result = await api.get<Paginated<Poll>>(`/polls?page=${page}&limit=${limit}`);
      setRows(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const create = async () => {
    const options = optionsText
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    if (!question.trim()) return setFormError("Question is required");
    if (options.length < 2) return setFormError("Add at least two options (one per line)");
    setSaving(true);
    setFormError(null);
    try {
      await api.post("/polls", { question, classId: classId || null, options });
      setModalOpen(false);
      setQuestion("");
      setClassId("");
      setOptionsText("");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create poll");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (p: Poll) => {
    setRowError(null);
    try {
      await api.patch(`/polls/${p.id}`, { isPublished: !p.isPublished });
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to update");
    }
  };

  const removePoll = async (p: Poll) => {
    if (!confirm(`Delete poll "${p.question}"?`)) return;
    setRowError(null);
    try {
      await api.delete(`/polls/${p.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Polls"
        subtitle="Quick polls & surveys"
        action={<Button onClick={() => setModalOpen(true)}>+ New poll</Button>}
      />

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No polls yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Question</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Votes</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium text-ink">{p.question}</td>
                  <td className="px-4 py-3 text-muted">{p.className ?? "School-wide"}</td>
                  <td className="px-4 py-3 text-muted">{p.totalVotes}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        p.isPublished
                          ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                          : "rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted"
                      }
                    >
                      {p.isPublished ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3">
                      <Link href={`/polls/${p.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                        Results
                      </Link>
                      <button onClick={() => togglePublish(p)} className="text-xs font-medium text-brand-600 hover:underline">
                        {p.isPublished ? "Unpublish" : "Publish"}
                      </button>
                      <button onClick={() => removePoll(p)} className="text-xs font-medium text-red-600 hover:text-red-700">
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

      <Modal title="New poll" open={modalOpen} onClose={() => setModalOpen(false)}>
        <div className="space-y-4">
          <Field label="Question">
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} />
          </Field>
          <Field label={term.klass}>
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">School-wide</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Options (one per line, min 2)">
            <Textarea rows={4} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder={"Option A\nOption B"} />
          </Field>
          <ErrorNote message={formError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={saving}>
              {saving ? "Saving…" : "Create poll"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
