"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/use-permissions";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from "@/components/ui";
import type {
  BookCopy,
  BookCopyStatus,
  LibraryBookDetail,
} from "@/types";

// Copies can only be set to these statuses manually (issued is system-managed).
const EDITABLE_STATUSES: BookCopyStatus[] = [
  "available",
  "lost",
  "damaged",
  "retired",
];

function copyStatusTone(
  status: BookCopyStatus
): "green" | "blue" | "red" | "amber" | "slate" {
  if (status === "available") return "green";
  if (status === "issued") return "blue";
  if (status === "lost") return "red";
  if (status === "damaged") return "amber";
  return "slate";
}

const copySchema = z.object({
  accessionNumber: z.string().optional(),
  barcode: z.string().optional(),
  status: z.string().optional(),
});

type CopyForm = z.infer<typeof copySchema>;

export default function BookCopiesPage() {
  const params = useParams<{ id: string }>();
  const bookId = params.id;

  const { can, loading: permsLoading } = usePermissions();
  const canCreate = can("library:create");
  const canUpdate = can("library:update");
  const canDelete = can("library:delete");

  const [book, setBook] = useState<LibraryBookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BookCopy | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setBook(await api.get<LibraryBookDetail>(`/library/books/${bookId}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : "Failed to load book"
      );
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    load();
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CopyForm>({ resolver: zodResolver(copySchema) });

  const openCreate = () => {
    setEditing(null);
    setCopyError(null);
    reset({ accessionNumber: "", barcode: "", status: "" });
    setModalOpen(true);
  };

  const openEdit = (copy: BookCopy) => {
    setEditing(copy);
    setCopyError(null);
    reset({
      accessionNumber: copy.accessionNumber ?? "",
      barcode: copy.barcode ?? "",
      status: copy.status,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: CopyForm) => {
    setCopyError(null);
    try {
      if (editing) {
        await api.patch(`/library/copies/${editing.id}`, {
          accessionNumber: values.accessionNumber || undefined,
          barcode: values.barcode || undefined,
          status: values.status || undefined,
        });
      } else {
        await api.post(`/library/books/${bookId}/copies`, {
          accessionNumber: values.accessionNumber || undefined,
          barcode: values.barcode || undefined,
        });
      }
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setCopyError(
        err instanceof ApiError ? err.message : "Failed to save copy"
      );
    }
  };

  const removeCopy = async (copy: BookCopy) => {
    if (!confirm(`Delete copy ${copy.accessionNumber ?? copy.id}?`)) return;
    try {
      await api.delete(`/library/copies/${copy.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete copy");
    }
  };

  if (permsLoading || loading) {
    return (
      <>
        <PageHeader title="Book copies" />
        <Spinner />
      </>
    );
  }

  if (!can("library:read")) {
    return (
      <>
        <PageHeader title="Book copies" />
        <EmptyState message="You do not have access to the library." />
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Book copies" />
        <div className="mb-4">
          <Link
            href="/library/catalogue"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            ← Back to Catalogue
          </Link>
        </div>
        <ErrorNote message={loadError} />
      </>
    );
  }

  if (!book) {
    return (
      <>
        <PageHeader title="Book copies" />
        <EmptyState message="Book not found" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={book.title}
        subtitle={book.author ?? undefined}
        action={
          canCreate ? (
            <Button onClick={openCreate}>+ Add copy</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Link
          href="/library/catalogue"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          ← Back to Catalogue
        </Link>
      </div>

      <Card className="mb-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-slate-500">Category</dt>
            <dd className="font-medium text-slate-900">
              {book.categoryName ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">ISBN</dt>
            <dd className="font-mono text-xs text-slate-900">
              {book.isbn ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Publisher</dt>
            <dd className="font-medium text-slate-900">
              {book.publisher ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Rack location</dt>
            <dd className="font-medium text-slate-900">
              {book.rackLocation ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Copies</dt>
            <dd className="font-medium text-slate-900">
              {book.availableCopies} available / {book.totalCopies} total
            </dd>
          </div>
        </dl>
      </Card>

      {book.copies.length === 0 ? (
        <EmptyState message="No copies yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Accession #</th>
                <th className="px-4 py-3">Barcode</th>
                <th className="px-4 py-3">Status</th>
                {(canUpdate || canDelete) && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {book.copies.map((copy) => (
                <tr key={copy.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    {copy.accessionNumber ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {copy.barcode ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={copyStatusTone(copy.status)}>
                      {copy.status}
                    </Badge>
                  </td>
                  {(canUpdate || canDelete) && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        {canUpdate && (
                          <button
                            onClick={() => openEdit(copy)}
                            className="text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => removeCopy(copy)}
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        title={editing ? "Edit copy" : "Add copy"}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Accession #" error={errors.accessionNumber?.message}>
            <Input
              placeholder="Auto-generated if blank"
              {...register("accessionNumber")}
            />
          </Field>
          <Field label="Barcode" error={errors.barcode?.message}>
            <Input {...register("barcode")} />
          </Field>
          {editing && (
            <Field label="Status" error={errors.status?.message}>
              {editing.status === "issued" ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  This copy is currently issued. Return it to change its status.
                </p>
              ) : (
                <Select {...register("status")}>
                  {EDITABLE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <ErrorNote message={copyError} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save copy"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
