"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { Button, EmptyState, ErrorNote, Input, PageHeader, Spinner } from "@/components/ui";

interface Photo {
  id: string;
  imageUrl: string;
  caption: string | null;
}
interface Album {
  id: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  photoCount: number;
  photos: Photo[];
}

export default function AlbumDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAlbum(await api.get<Album>(`/gallery/albums/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load album");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const addPhoto = async () => {
    if (!imageUrl.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api.post(`/gallery/albums/${id}/photos`, { imageUrl, caption: caption || undefined });
      setImageUrl("");
      setCaption("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add photo");
    } finally {
      setAdding(false);
    }
  };

  const togglePublish = async () => {
    if (!album) return;
    try {
      await api.patch(`/gallery/albums/${id}`, { isPublished: !album.isPublished });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update");
    }
  };

  const removePhoto = async (photoId: string) => {
    setError(null);
    try {
      await api.delete(`/gallery/photos/${photoId}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  };

  if (loading) return <Spinner />;
  if (!album) return <ErrorNote message={error ?? "Album not found"} />;

  return (
    <>
      <div className="mb-2">
        <Link href="/gallery" className="text-sm text-brand-600 hover:underline">
          ← Back to gallery
        </Link>
      </div>
      <PageHeader
        title={album.title}
        subtitle={`${album.photoCount} photos`}
        action={
          <Button variant={album.isPublished ? "secondary" : "primary"} onClick={togglePublish}>
            {album.isPublished ? "Unpublish" : "Publish"}
          </Button>
        }
      />

      <ErrorNote message={error} />

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex-1 min-w-[240px]">
          <label className="mb-1 block text-xs font-medium text-muted">Image URL</label>
          <Input placeholder="https://…" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-muted">Caption</label>
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} />
        </div>
        <Button onClick={addPhoto} disabled={adding || !imageUrl.trim()}>
          {adding ? "Adding…" : "Add photo"}
        </Button>
      </div>

      {album.photos.length === 0 ? (
        <EmptyState message="No photos yet — add the first one." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {album.photos.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="aspect-square bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.imageUrl} alt={p.caption ?? "Photo"} className="h-full w-full object-cover" />
              </div>
              <div className="flex items-center justify-between gap-2 p-2">
                <span className="truncate text-xs text-muted">{p.caption ?? "—"}</span>
                <button
                  onClick={() => removePhoto(p.id)}
                  className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
