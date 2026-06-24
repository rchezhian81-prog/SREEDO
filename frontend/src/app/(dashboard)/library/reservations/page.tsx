"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import {
  Button,
  EmptyState,
  ErrorNote,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type { Paginated } from "@/types";

interface Reservation {
  id: string;
  bookTitle: string;
  bookAuthor: string | null;
  studentName: string;
  admissionNo: string | null;
  status: "pending" | "fulfilled" | "cancelled" | "expired";
  notes: string | null;
  requestedAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  fulfilled: "bg-green-100 text-green-700",
  cancelled: "bg-surface-2 text-muted",
  expired: "bg-surface-2 text-muted",
};

export default function LibraryReservationsPage() {
  const [rows, setRows] = useState<Reservation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [rowError, setRowError] = useState<string | null>(null);

  const limit = 15;

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status) params.set("status", status);
      const result = await api.get<Paginated<Reservation>>(`/reservations?${params.toString()}`);
      setRows(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const resolve = async (r: Reservation, next: "fulfilled" | "cancelled") => {
    setRowError(null);
    try {
      await api.patch(`/reservations/${r.id}`, { status: next });
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to update");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="mb-2">
        <Link href="/library" className="text-sm text-brand-600 hover:underline">
          ← Back to library
        </Link>
      </div>
      <PageHeader title="Reservations" subtitle="Book reservation requests from students" />

      <div className="mb-4 w-44">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </Select>
      </div>

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No reservations" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Book</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{r.bookTitle}</div>
                    {r.bookAuthor ? <div className="text-xs text-muted">{r.bookAuthor}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {r.studentName}
                    {r.admissionNo ? <span className="text-xs"> ({r.admissionNo})</span> : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status === "pending" ? (
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => resolve(r, "fulfilled")}
                          className="text-xs font-medium text-green-700 hover:underline"
                        >
                          Fulfil
                        </button>
                        <button
                          onClick={() => resolve(r, "cancelled")}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
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
    </>
  );
}
