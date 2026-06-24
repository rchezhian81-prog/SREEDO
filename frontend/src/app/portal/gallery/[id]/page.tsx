"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { portalApi } from "@/lib/portal-api";
import { EmptyState, ErrorNote, Spinner } from "@/components/ui";

interface Photo {
  id: string;
  imageUrl: string;
  caption: string | null;
}
interface Album {
  id: string;
  title: string;
  description: string | null;
  photos: Photo[];
}

export default function PortalAlbumPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAlbum(await portalApi.get<Album>(`/portal/gallery/${id}`));
    } catch {
      setError("Could not load this album.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner />;
  if (!album) return <ErrorNote message={error ?? "Album not found"} />;

  return (
    <div>
      <div className="mb-2">
        <Link href="/portal/gallery" className="text-sm text-brand-600 hover:underline">
          ← Back to gallery
        </Link>
      </div>
      <h1 className="text-2xl font-semibold text-slate-900">{album.title}</h1>
      {album.description ? <p className="mb-4 text-sm text-slate-500">{album.description}</p> : <div className="mb-4" />}

      {album.photos.length === 0 ? (
        <EmptyState message="This album has no photos yet." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {album.photos.map((p) => (
            <figure key={p.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="aspect-square bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.imageUrl} alt={p.caption ?? "Photo"} className="h-full w-full object-cover" />
              </div>
              {p.caption ? (
                <figcaption className="p-2 text-xs text-slate-500">{p.caption}</figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
