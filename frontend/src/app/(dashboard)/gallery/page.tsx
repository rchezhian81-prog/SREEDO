"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  Textarea,
} from "@/components/ui";
import type { Paginated } from "@/types";

interface Album {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  isPublished: boolean;
  photoCount: number;
}

const albumSchema = z.object({
  title: z.string().min(1, "Required"),
  description: z.string().optional(),
  coverUrl: z.string().url("Enter a valid URL").optional().or(z.literal("")),
});
type AlbumForm = z.infer<typeof albumSchema>;

export default function GalleryPage() {
  const [rows, setRows] = useState<Album[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const limit = 12;

  const load = useCallback(async () => {
    setLoading(true);
    setRowError(null);
    try {
      const result = await api.get<Paginated<Album>>(`/gallery/albums?page=${page}&limit=${limit}`);
      setRows(result.data);
      setTotal(result.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AlbumForm>({ resolver: zodResolver(albumSchema) });

  const onSubmit = async (values: AlbumForm) => {
    setServerError(null);
    try {
      await api.post("/gallery/albums", { ...values, coverUrl: values.coverUrl || undefined });
      setModalOpen(false);
      reset();
      await load();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Failed to save");
    }
  };

  const removeAlbum = async (a: Album) => {
    if (!confirm(`Delete album "${a.title}" and its photos?`)) return;
    setRowError(null);
    try {
      await api.delete(`/gallery/albums/${a.id}`);
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <PageHeader
        title="Gallery"
        subtitle="Photo albums"
        action={<Button onClick={() => setModalOpen(true)}>+ New album</Button>}
      />

      <ErrorNote message={rowError} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No albums yet" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => (
            <div key={a.id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="aspect-video bg-surface-2">
                {a.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.coverUrl} alt={a.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted">No cover</div>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-ink">{a.title}</h3>
                  <span
                    className={
                      a.isPublished
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
                        : "rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted"
                    }
                  >
                    {a.isPublished ? "Published" : "Draft"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">{a.photoCount} photos</p>
                <div className="mt-3 flex gap-3">
                  <Link href={`/gallery/${a.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                    Manage
                  </Link>
                  <button onClick={() => removeAlbum(a)} className="text-xs font-medium text-red-600 hover:text-red-700">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
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

      <Modal title="New album" open={modalOpen} onClose={() => setModalOpen(false)}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Title" error={errors.title?.message}>
            <Input {...register("title")} />
          </Field>
          <Field label="Cover image URL" error={errors.coverUrl?.message}>
            <Input placeholder="https://…" {...register("coverUrl")} />
          </Field>
          <Field label="Description">
            <Textarea rows={2} {...register("description")} />
          </Field>
          <ErrorNote message={serverError} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
