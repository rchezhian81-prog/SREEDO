"use client";

import { useCallback, useEffect, useState } from "react";
import { portalApi } from "@/lib/portal-api";
import { usePortalStore } from "@/stores/portal-store";
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { useI18n } from "@/i18n/I18nProvider";

interface Book {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  availableCopies: number;
}

interface Reservation {
  id: string;
  bookTitle: string;
  status: "pending" | "fulfilled" | "cancelled" | "expired";
  requestedAt: string;
}

export default function PortalLibraryPage() {
  const { t } = useI18n();
  const studentId = usePortalStore((state) => state.selectedStudentId);
  const [books, setBooks] = useState<Book[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadReservations = useCallback(async () => {
    if (!studentId) return;
    setReservations(await portalApi.get<Reservation[]>(`/portal/students/${studentId}/reservations`));
  }, [studentId]);

  const loadBooks = useCallback(async () => {
    const q = search ? `?search=${encodeURIComponent(search)}` : "";
    setBooks(await portalApi.get<Book[]>(`/portal/library/books${q}`));
  }, [search]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([loadBooks(), loadReservations()])
      .catch(() => setError("Could not load the library."))
      .finally(() => setLoading(false));
  }, [loadBooks, loadReservations]);

  const reserve = async (book: Book) => {
    if (!studentId) return;
    setBusyId(book.id);
    setError(null);
    try {
      await portalApi.post(`/portal/students/${studentId}/reservations`, { bookId: book.id });
      await loadReservations();
    } catch {
      setError("Could not reserve this book — you may already have a pending reservation for it.");
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (r: Reservation) => {
    if (!studentId) return;
    setBusyId(r.id);
    setError(null);
    try {
      await portalApi.post(`/portal/students/${studentId}/reservations/${r.id}/cancel`);
      await loadReservations();
    } catch {
      setError("Could not cancel the reservation.");
    } finally {
      setBusyId(null);
    }
  };

  const pendingBookTitles = new Set(
    reservations.filter((r) => r.status === "pending").map((r) => r.bookTitle)
  );

  return (
    <div>
      <PageHeader title={t("portalNav.library")} subtitle="Browse the catalogue and reserve books" />

      <ErrorNote message={error} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 font-semibold text-slate-900">My reservations</h2>
            {reservations.length === 0 ? (
              <EmptyState message="You have no reservations yet." />
            ) : (
              <div className="space-y-2">
                {reservations.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2"
                  >
                    <div>
                      <span className="font-medium text-slate-900">{r.bookTitle}</span>
                      <span className="ml-2 text-xs capitalize text-slate-500">{r.status}</span>
                    </div>
                    {r.status === "pending" ? (
                      <button
                        onClick={() => cancel(r)}
                        disabled={busyId === r.id}
                        className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 font-semibold text-slate-900">Browse books</h2>
            <div className="mb-3 max-w-sm">
              <Input
                placeholder="Search by title or author…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {books.length === 0 ? (
              <EmptyState message="No books found." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {books.map((b) => {
                  const reserved = pendingBookTitles.has(b.title);
                  return (
                    <Card key={b.id} className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">{b.title}</h3>
                        <p className="text-xs text-slate-500">
                          {b.author ?? "Unknown author"} ·{" "}
                          {b.availableCopies > 0
                            ? `${b.availableCopies} available`
                            : "None available"}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        disabled={reserved || busyId === b.id}
                        onClick={() => reserve(b)}
                      >
                        {reserved ? "Reserved" : "Reserve"}
                      </Button>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
